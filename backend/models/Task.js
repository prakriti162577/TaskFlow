
const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
    {
        taskId: {
            type: String,
            unique: true,
            default: () => "TASK-" + new mongoose.Types.ObjectId().toString().toUpperCase()
        },

        title: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            default: ""
        },

        category: {
            type: String,
            required: true
        },

        priority: {
            type: String,
            enum: ["High", "Medium", "Low"],
            required: true
        },

        dueDate: {
            type: Date,
            required: true
        },

        status: {
            type: String,
            enum: ["Pending", "In Progress", "Completed"],
            default: "Pending"
        },

        tags: {
            type: [String],
            default: []
        },

        revision: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Task", taskSchema);
