
const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");

const router = express.Router();

// Escape special characters in search text
const escapeRegex = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Find task using MongoDB ID or custom taskId
const findTask = (id) => {
    if (mongoose.isValidObjectId(id)) {
        return Task.findOne({
            $or: [{ _id: id }, { taskId: id }]
        });
    }

    return Task.findOne({ taskId: id });
};

// CREATE: Add a new task
router.post("/", async (req, res) => {
    try {
        const task = await Task.create(req.body);

        res.status(201).json({
            success: true,
            message: "Task created successfully",
            data: task
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// READ: Get all tasks with search, filters and sorting
router.get("/", async (req, res) => {
    try {
        const {
            search,
            priority,
            category,
            status,
            dueFrom,
            dueTo,
            dueAfter,
            dueBefore,
            categories,
            priorities,
            excludeStatus,
            sortBy = "createdAt",
            order = "desc",
            page = 1,
            limit = 100
        } = req.query;

        const conditions = [];

        // Search using $or
        if (search) {
            const searchRegex = new RegExp(
                escapeRegex(search),
                "i"
            );

            conditions.push({
                $or: [
                    { title: searchRegex },
                    { description: searchRegex },
                    { category: searchRegex },
                    { taskId: searchRegex },
                    { tags: searchRegex }
                ]
            });
        }

        // Priority filter
        if (priority) {
            conditions.push({ priority });
        }

        // Category filter
        if (category) {
            conditions.push({ category });
        }

        // Multiple category values using $in
        if (categories) {
            conditions.push({
                category: {
                    $in: categories.split(",")
                }
            });
        }

        // Multiple priority values using $in
        if (priorities) {
            conditions.push({
                priority: {
                    $in: priorities.split(",")
                }
            });
        }

        // Status filter
        if (status) {
            conditions.push({ status });
        }

        // Not equal operator
        if (excludeStatus) {
            conditions.push({
                status: { $ne: excludeStatus }
            });
        }

        // Due date comparison operators
        if (dueAfter) {
            const date = new Date(dueAfter);

            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid dueAfter date"
                });
            }

            conditions.push({
                dueDate: { $gt: date }
            });
        }

        if (dueBefore) {
            const date = new Date(dueBefore);

            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid dueBefore date"
                });
            }

            conditions.push({
                dueDate: { $lt: date }
            });
        }


        // Greater than or equal to
if (dueFrom) {
    conditions.push({
        dueDate: { $gte: new Date(dueFrom) }
    });
}

// Less than or equal to
if (dueTo) {
    conditions.push({
        dueDate: { $lte: new Date(dueTo) }
    });
}
        // Combine filters using $and
        const filter = conditions.length
            ? { $and: conditions }
            : {};

        // Allow only selected sorting fields
        const allowedSortFields = [
            "createdAt",
            "dueDate",
            "title",
            "priority",
            "updatedAt"
        ];

        const sortField = allowedSortFields.includes(sortBy)
            ? sortBy
            : "createdAt";

        const sortOrder = order === "asc" ? 1 : -1;

        const pageNumber = Math.max(1, parseInt(page) || 1);
        const limitNumber = Math.min(
            100,
            Math.max(1, parseInt(limit) || 100)
        );

        const tasks = await Task.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber);

        const total = await Task.countDocuments(filter);

        res.json({
            success: true,
            total,
            page: pageNumber,
            data: tasks,
            message: tasks.length
                ? "Tasks retrieved successfully"
                : "No matching tasks found"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// READ: Get task by MongoDB ID or taskId
router.get("/:id", async (req, res) => {
    try {
        const task = await findTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found"
            });
        }

        res.json({
            success: true,
            data: task
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// UPDATE: Edit a task
router.put("/:id", async (req, res) => {
    try {
        const allowedFields = [
            "title",
            "description",
            "category",
            "priority",
            "dueDate",
            "status",
            "tags"
        ];

        const updates = {};

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid fields provided"
            });
        }

        const task = await findTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found"
            });
        }

        const updatedTask = await Task.findByIdAndUpdate(
            task._id,
            {
                $set: updates,
                $inc: { revision: 1 }
            },
            {
                new: true,
                runValidators: true
            }
        );

        res.json({
            success: true,
            message: "Task updated successfully",
            data: updatedTask
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// ADD TAG: Demonstrate $push
router.patch("/:id/tags", async (req, res) => {
    try {
        const { tag } = req.body;

        if (typeof tag !== "string" || !tag.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid tag"
            });
        }

        const task = await findTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found"
            });
        }

        const updatedTask = await Task.findByIdAndUpdate(
            task._id,
            {
                $push: { tags: tag.trim() },
                $inc: { revision: 1 }
            },
            { new: true }
        );

        res.json({
            success: true,
            message: "Tag added successfully",
            data: updatedTask
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// REMOVE TAG: Demonstrate $pull
router.delete("/:id/tags", async (req, res) => {
    try {
        const { tag } = req.body;
        const task = await findTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found"
            });
        }

        const updatedTask = await Task.findByIdAndUpdate(
            task._id,
            {
                $pull: { tags: tag },
                $inc: { revision: 1 }
            },
            { new: true }
        );

        res.json({
            success: true,
            message: "Tag removed successfully",
            data: updatedTask
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// UPDATE MANY: Change status of multiple tasks
router.patch("/bulk/status", async (req, res) => {
    try {
        const { newStatus, category, priority } = req.body;

        if (!["Pending", "In Progress", "Completed"].includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status"
            });
        }

        const conditions = [];

        if (category) conditions.push({ category });
        if (priority) conditions.push({ priority });

        if (conditions.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Provide at least one filter"
            });
        }

        const filter = { $and: conditions };

        const result = await Task.updateMany(
            filter,
            {
                $set: { status: newStatus },
                $inc: { revision: 1 }
            }
        );

        res.json({
            success: true,
            message: "Multiple tasks updated successfully",
            modifiedCount: result.modifiedCount
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// DELETE MANY: Delete all completed tasks
router.delete("/bulk/completed", async (req, res) => {
    try {
        const result = await Task.deleteMany({
            status: "Completed"
        });

        res.json({
            success: true,
            message: "Completed tasks deleted successfully",
            deletedCount: result.deletedCount
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// DELETE: Delete an individual task
router.delete("/:id", async (req, res) => {
    try {
        const task = await findTask(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found"
            });
        }

        await Task.findByIdAndDelete(task._id);

        res.json({
            success: true,
            message: "Task deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
