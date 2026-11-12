
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const Task = require("./models/Task");

dotenv.config();

const getDate = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
};

const sampleTasks = [
    {
        title: "Complete MongoDB Mini Project",
        description: "Develop the Personal Task Management System",
        category: "Academic",
        priority: "High",
        dueDate: getDate(2),
        status: "In Progress",
        tags: ["mongodb", "college"]
    },
    {
        title: "Prepare DBMS Practical File",
        description: "Complete SQL experiments and documentation",
        category: "Academic",
        priority: "High",
        dueDate: getDate(1),
        status: "Pending",
        tags: ["dbms", "practical"]
    },
    {
        title: "Study Java Programming",
        description: "Revise object oriented programming concepts",
        category: "Study",
        priority: "Medium",
        dueDate: getDate(4),
        status: "Pending",
        tags: ["java", "revision"]
    },
    {
        title: "Complete Project Documentation",
        description: "Prepare project report and diagrams",
        category: "Project",
        priority: "High",
        dueDate: getDate(3),
        status: "In Progress",
        tags: ["report", "documentation"]
    },
    {
        title: "Attend Team Meeting",
        description: "Discuss project development progress",
        category: "Work",
        priority: "Medium",
        dueDate: getDate(0),
        status: "Pending",
        tags: ["meeting", "team"]
    },
    {
        title: "Organize Study Materials",
        description: "Arrange notes and important reference files",
        category: "Personal",
        priority: "Low",
        dueDate: getDate(7),
        status: "Completed",
        tags: ["organization"]
    },
    {
        title: "Complete Python Assignment",
        description: "Finish programming exercises",
        category: "Academic",
        priority: "High",
        dueDate: getDate(-2),
        status: "Pending",
        tags: ["python", "assignment"]
    },
    {
        title: "Read Machine Learning Notes",
        description: "Revise neural network fundamentals",
        category: "Study",
        priority: "Medium",
        dueDate: getDate(5),
        status: "In Progress",
        tags: ["ml", "notes"]
    },
    {
        title: "Update Resume",
        description: "Add recent projects and technical skills",
        category: "Career",
        priority: "Medium",
        dueDate: getDate(8),
        status: "Pending",
        tags: ["resume", "career"]
    },
    {
        title: "Exercise and Walk",
        description: "Complete daily fitness routine",
        category: "Health",
        priority: "Low",
        dueDate: getDate(0),
        status: "Completed",
        tags: ["fitness", "daily"]
    },
    {
        title: "Prepare Presentation",
        description: "Create slides for project demonstration",
        category: "Academic",
        priority: "High",
        dueDate: getDate(3),
        status: "Pending",
        tags: ["presentation"]
    },
    {
        title: "Clean Workspace",
        description: "Organize desk and laptop files",
        category: "Personal",
        priority: "Low",
        dueDate: getDate(6),
        status: "Completed",
        tags: ["cleaning"]
    },
    {
        title: "Practice JavaScript",
        description: "Revise DOM manipulation and events",
        category: "Study",
        priority: "Medium",
        dueDate: getDate(2),
        status: "In Progress",
        tags: ["javascript", "coding"]
    },
    {
        title: "Submit Internship Application",
        description: "Prepare and submit application documents",
        category: "Career",
        priority: "High",
        dueDate: getDate(1),
        status: "Pending",
        tags: ["internship", "career"]
    },
    {
        title: "Review Weekly Progress",
        description: "Check completed tasks and plan upcoming work",
        category: "Personal",
        priority: "Low",
        dueDate: getDate(9),
        status: "Pending",
        tags: ["planning", "weekly"]
    }
];

const seedDatabase = async () => {
    try {
        await connectDB();

        // Check whether sample tasks already exist
        const existingCount = await Task.countDocuments();

        if (existingCount > 0) {
            console.log(
                `Database already contains ${existingCount} tasks.`
            );
            console.log("Seeding skipped to prevent duplicates.");
            process.exit(0);
        }

        // Assign unique IDs to sample tasks
        const tasksWithIds = sampleTasks.map((task, index) => ({
            ...task,
            taskId: `TASK${String(index + 1).padStart(3, "0")}`
        }));

        // Insert all 15 documents
        const result = await Task.insertMany(tasksWithIds);

        console.log("--------------------------------");
        console.log("TaskFlow Database Seeded!");
        console.log(`${result.length} tasks inserted successfully.`);
        console.log("Task IDs: TASK001 to TASK015");
        console.log("--------------------------------");

        process.exit(0);

    } catch (error) {
        console.error("Seeding failed:", error.message);
        process.exit(1);
    }
};

seedDatabase();
