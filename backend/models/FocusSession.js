const mongoose = require("mongoose");

const focusSessionSchema = new mongoose.Schema(
    {
        task: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            required: true,
            index: true
        },
        taskId: {
            type: String,
            required: true,
            index: true
        },
        taskTitle: {
            type: String,
            required: true
        },
        sessionType: {
            type: String,
            enum: ["focus", "shortBreak", "longBreak"],
            default: "focus"
        },
        status: {
            type: String,
            enum: ["running", "paused", "completed", "stopped"],
            default: "running",
            index: true
        },
        targetSeconds: {
            type: Number,
            required: true,
            min: 1
        },
        elapsedSeconds: {
            type: Number,
            default: 0,
            min: 0
        },
        startedAt: {
            type: Date,
            default: Date.now
        },
        lastResumedAt: {
            type: Date,
            default: Date.now
        },
        endedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("FocusSession", focusSessionSchema);
