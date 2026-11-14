const dotenv = require("dotenv");
const path = require("path");

// Load .env from the main TaskFlow folder
dotenv.config({
    path: path.resolve(__dirname, "../.env")
});

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const taskRoutes = require("./routes/taskRoutes");
const focusSessionRoutes = require("./routes/focusSessionRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("TaskFlow API is running successfully!");
});

app.get("/api/health", (req, res) => {
    res.json({ success: true, message: "TaskFlow backend is working!" });
});

app.use("/api/tasks", taskRoutes);
app.use("/api/focus-sessions", focusSessionRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`TaskFlow server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Server startup failed:", error.message);
        process.exit(1);
    }
};

startServer();
