const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Task = require("../models/Task");
const FocusSession = require("../models/FocusSession");

async function findTask(identifier) {
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        const byId = await Task.findById(identifier);
        if (byId) return byId;
    }
    return Task.findOne({ taskId: identifier });
}

function currentElapsed(session, now = new Date()) {
    let elapsed = Number(session.elapsedSeconds || 0);
    if (session.status === "running" && session.lastResumedAt) {
        elapsed += Math.max(0, Math.floor((now - new Date(session.lastResumedAt)) / 1000));
    }
    return elapsed;
}

// Start a new focus or break session.
router.post("/", async (req, res) => {
    try {
        const { taskId, targetSeconds, sessionType = "focus" } = req.body;
        const duration = Number(targetSeconds);

        if (!taskId || !Number.isInteger(duration) || duration < 1 || duration > 86400) {
            return res.status(400).json({ success: false, message: "Provide a taskId and a duration between 1 and 86400 seconds." });
        }
        if (!["focus", "shortBreak", "longBreak"].includes(sessionType)) {
            return res.status(400).json({ success: false, message: "Invalid session type." });
        }

        const active = await FocusSession.findOne({ status: { $in: ["running", "paused"] } });
        if (active) {
            return res.status(409).json({ success: false, message: "Finish or stop the active timer before starting another session.", data: active });
        }

        const task = await findTask(String(taskId));
        if (!task) return res.status(404).json({ success: false, message: "Task not found." });

        const now = new Date();
        const session = await FocusSession.create({
            task: task._id,
            taskId: task.taskId,
            taskTitle: task.title,
            sessionType,
            targetSeconds: duration,
            status: "running",
            startedAt: now,
            lastResumedAt: now
        });

        res.status(201).json({ success: true, message: "Focus session started.", data: session });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Return the currently running or paused timer, if one exists.
router.get("/active", async (req, res) => {
    try {
        const session = await FocusSession.findOne({ status: { $in: ["running", "paused"] } }).sort({ createdAt: -1 });
        if (!session) return res.json({ success: true, data: null });
        res.json({
            success: true,
            data: {
                ...session.toObject(),
                elapsedSeconds: currentElapsed(session)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Pause a running session and persist its elapsed time.
router.patch("/:id/pause", async (req, res) => {
    try {
        const session = await FocusSession.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: "Focus session not found." });
        if (session.status !== "running") return res.status(409).json({ success: false, message: "Only a running session can be paused." });

        const now = new Date();
        session.elapsedSeconds = currentElapsed(session, now);
        session.status = "paused";
        session.lastResumedAt = null;
        await session.save();
        res.json({ success: true, message: "Focus session paused.", data: session });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Resume a paused session.
router.patch("/:id/resume", async (req, res) => {
    try {
        const session = await FocusSession.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: "Focus session not found." });
        if (session.status !== "paused") return res.status(409).json({ success: false, message: "Only a paused session can be resumed." });

        session.status = "running";
        session.lastResumedAt = new Date();
        await session.save();
        res.json({ success: true, message: "Focus session resumed.", data: session });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Complete or stop a session. Only completed focus sessions count toward task focus time.
router.patch("/:id/finish", async (req, res) => {
    try {
        const session = await FocusSession.findById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: "Focus session not found." });
        if (!["running", "paused"].includes(session.status)) {
            return res.status(409).json({ success: false, message: "This session has already ended." });
        }

        const now = new Date();
        session.elapsedSeconds = currentElapsed(session, now);
        session.status = (req.body || {}).completed === false ? "stopped" : "completed";
        session.endedAt = now;
        session.lastResumedAt = null;
        await session.save();

        const total = await FocusSession.aggregate([
            { $match: { task: session.task, sessionType: "focus", status: { $in: ["completed", "stopped"] } } },
            { $group: { _id: null, totalSeconds: { $sum: "$elapsedSeconds" }, sessions: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            message: session.status === "completed" ? "Focus session completed and saved." : "Focus session stopped and saved.",
            data: session,
            taskFocusSummary: {
                totalSeconds: total[0]?.totalSeconds || 0,
                sessions: total[0]?.sessions || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get focus history and total focus time for a task (accepts MongoDB _id or taskId).
router.get("/task/:taskIdentifier", async (req, res) => {
    try {
        const task = await findTask(req.params.taskIdentifier);
        if (!task) return res.status(404).json({ success: false, message: "Task not found." });

        const sessions = await FocusSession.find({ task: task._id }).sort({ createdAt: -1 });
        const summary = await FocusSession.aggregate([
            { $match: { task: task._id, sessionType: "focus", status: { $in: ["completed", "stopped"] } } },
            { $group: { _id: null, totalSeconds: { $sum: "$elapsedSeconds" }, sessions: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            task: { _id: task._id, taskId: task.taskId, title: task.title },
            totalFocusSeconds: summary[0]?.totalSeconds || 0,
            completedFocusSessions: summary[0]?.sessions || 0,
            data: sessions
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
