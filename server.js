const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const cookieParser = require('cookie-parser');
const Request = require('./models/Request');
const app = express();
const PORT = process.env.PORT || 3000;
const path = require('path');

// MongoDB connection URI
const uri = "mongodb+srv://joshmalkipc:Cindy130506@cluster0.8z7zu.mongodb.net/overtime-scheduler?retryWrites=true&w=majority&appName=Cluster0";

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('view engine', 'ejs');

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
  }
}

// Middleware to authenticate
async function authenticate(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, 'SECRET_KEY');
    const user = await User.findById(decoded.userId).select('username role');
    if (!user) return res.redirect('/login');

    req.user = user; // Now req.user includes username
    next();
  } catch (err) {
    res.redirect('/login');
  }
}

// Routes

app.get('/dashboard', authenticate, async (req, res) => {
  try {
    let requests;
    let requestsByUser = {}; // To store requests grouped by user
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0 = January, 11 = December
    const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1; // Handle January edge case
    const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Fetch all requests for admins, supervisors, and CEO
    if (req.user.role === 'admin' || req.user.role === 'supervisor' || req.user.role === 'ceo') {
      requests = await Request.find()
        .populate('createdBy', 'username') // Populate the createdBy field with the username
        .populate('approvedBy', 'username') // Populate the approvedBy field with the username
        .sort({ timeIn: -1 }); // Sort by timeIn (newest first)

      // Group requests by user
      requests.forEach(request => {
        if (!request.createdBy) {
          // Handle requests where the user was deleted
          const userId = 'deleted-user'; // Unique identifier for deleted users
          if (!requestsByUser[userId]) {
            requestsByUser[userId] = {
              username: 'Deleted User',
              requests: [],
            };
          }
          requestsByUser[userId].requests.push(request);
          return; // Skip further processing for this request
        }
        const userId = request.createdBy._id.toString();
        if (!requestsByUser[userId]) {
          requestsByUser[userId] = {
            username: request.createdBy.username,
            requests: [],
          };
        }
        requestsByUser[userId].requests.push(request);
      });
    } 
    // Fetch only the logged-in user's requests for employees
    else if (req.user.role === 'employee') {
      requests = await Request.find({ createdBy: req.user._id }) // Use _id instead of userId
        .populate('createdBy', 'username')
        .populate('approvedBy', 'username')
        .sort({ timeIn: -1 }); // Sort by timeIn (newest first)

      // Group requests by user (only the logged-in user)
      requestsByUser[req.user._id.toString()] = { // Use _id and convert to string
        username: req.user.username,
        requests,
      };
    }

    // Calculate totals for each user
    for (const userId in requestsByUser) {
      const userRequests = requestsByUser[userId].requests;

      // Filter requests that are approved and signed off by the CEO
      const signedOffRequests = userRequests.filter(
        request => request.status === 'ceo-signed-off'
      );

      // Calculate work and pay hours for previous and current month
      requestsByUser[userId].previousMonthWorkHours = calculateMonthlyWorkHours(
        signedOffRequests,
        previousYear,
        previousMonth
      );
      requestsByUser[userId].previousMonthPayHours = calculateMonthlyPaidHours(
        signedOffRequests,
        previousYear,
        previousMonth
      );
      requestsByUser[userId].currentMonthWorkHours = calculateMonthlyWorkHours(
        signedOffRequests,
        currentYear,
        currentMonth
      );
      requestsByUser[userId].currentMonthPayHours = calculateMonthlyPaidHours(
        signedOffRequests,
        currentYear,
        currentMonth
      );

      // Calculate total paid hours
      requestsByUser[userId].totalPaidHours = calculatePaidHours(signedOffRequests);
    }

    // Render the dashboard with the required data
    res.render('dashboard', {
      user: req.user,
      requestsByUser,
      currentYear,
      currentMonth,
      previousYear,
      previousMonth,
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Homepage
app.get('/', (req, res) => {
  res.render('index');
});

// User Registration
app.post('/register', async (req, res) => {
  const { username, password } = req.body; // Remove role from the request body
  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user with the role set to 'employee'
    const user = new User({ 
      username, 
      password: hashedPassword, 
      role: 'employee' // Default role
    });

    await user.save();
    res.status(201).send('User registered successfully');
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// User Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Find the user
    const user = await User.findOne({ username });
    if (!user) return res.status(400).send('User not found');

    // Check the password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).send('Invalid password');

    // Generate a JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role }, // Ensure username is included
      'SECRET_KEY'
    );
    
    // Set the token in a cookie
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard'); // Redirect to the dashboard
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Create a new overtime request
app.post('/requests', authenticate, async (req, res) => {
  const { site, duty, vehicle, timeIn, timeOut } = req.body;
  try {
    // Validate timeIn and timeOut
    if (!timeIn || !timeOut) {
      return res.status(400).send('Time In and Time Out are required.');
    }

    // Parse timeIn and timeOut as Date objects
    const timeInDate = new Date(timeIn);
    const timeOutDate = new Date(timeOut);

    // Validate the dates
    if (isNaN(timeInDate.getTime())) {
      return res.status(400).send('Invalid Time In.');
    }
    if (isNaN(timeOutDate.getTime())) {
      return res.status(400).send('Invalid Time Out.');
    }

    // Calculate total hours
    const totalHours = (timeOutDate - timeInDate) / (1000 * 60 * 60); // Convert milliseconds to hours

    // Create a new request
    const request = new Request({
      site,
      duty,
      vehicle,
      timeIn: timeInDate,
      timeOut: timeOutDate,
      totalHours,
      createdBy: req.user._id, // Attach the user ID from the token
    });
    await request.save();
    res.redirect('/dashboard'); // Redirect to the dashboard after submission
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Get all requests (for admin/CEO)
app.get('/requests', authenticate, async (req, res) => {
  try {
    const requests = await Request.find().populate('createdBy', 'username');
    res.json(requests);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Supervisor approval (Step 1)
app.post('/requests/:id/supervisor-approve', authenticate, async (req, res) => {
  const { id } = req.params;

  // Check if the user is a supervisor
  if (req.user.role !== 'supervisor') {
    return res.status(403).send('Only supervisors can approve requests at this stage.');
  }

  try {
    const request = await Request.findByIdAndUpdate(
      id,
      { status: 'supervisor-approved', approvedBy: req.user._id }, // Set status to 'supervisor-approved'
      { new: true }
    );
    res.redirect('/dashboard'); // Redirect back to the dashboard
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Admin approval (Step 2)
app.post('/requests/:id/admin-approve', authenticate, async (req, res) => {
  const { id } = req.params;

  // Check if the user is an admin
  if (req.user.role !== 'admin') {
    return res.status(403).send('Only admins can approve requests at this stage.');
  }

  try {
    const request = await Request.findByIdAndUpdate(
      id,
      { status: 'admin-approved', approvedBy: req.user._id }, // Set status to 'admin-approved'
      { new: true }
    );
    res.redirect('/dashboard'); // Redirect back to the dashboard
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// CEO sign-off (Step 3)
app.post('/requests/:id/ceo-signoff', authenticate, async (req, res) => {
  const { id } = req.params;

  // Check if the user is the CEO
  if (req.user.role !== 'ceo') {
    return res.status(403).send('Only the CEO can sign off on requests.');
  }

  try {
    const request = await Request.findByIdAndUpdate(
      id,
      { status: 'ceo-signed-off', ceoSignOff: true }, // Set status to 'ceo-signed-off'
      { new: true }
    );
    res.redirect('/dashboard'); // Redirect back to the dashboard
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Start the server
async function startServer() {
  await connectToDatabase(); // Connect to the database first
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.dir);

// Render the login page
app.get('/login', (req, res) => {
  res.render('login');
});

// Render the registration page
app.get('/register', (req, res) => {
  res.render('register');
});

// Render the dashboard (protected route)
app.get('/dashboard', authenticate, async (req, res) => {
  try {
    const requests = await Request.find().populate('createdBy', 'username');
    res.render('dashboard', { user: req.user, requests });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/logout', (req, res) => {
  // Clear the token cookie
  res.clearCookie('token');
  res.redirect('/login'); // Redirect to the login page
});

// Serve static files
app.use(express.static('public')); // Serve static files from the "public" directory

// Helper function to calculate work hours for a specific month
function calculateMonthlyWorkHours(requests, year, month) {
  return requests
    .filter(request => {
      const requestDate = new Date(request.timeIn);
      return (
        requestDate.getFullYear() === year &&
        requestDate.getMonth() === month &&
        request.status === 'ceo-signed-off' // Only count fully approved requests
      );
    })
    .reduce((total, request) => total + request.totalHours, 0);
}

// Helper function to calculate paid hours for a specific month
function calculateMonthlyPaidHours(requests, year, month) {
  return requests
    .filter(request => {
      const requestDate = new Date(request.timeIn);
      return (
        requestDate.getFullYear() === year &&
        requestDate.getMonth() === month &&
        request.status === 'ceo-signed-off' // Only count fully approved requests
      );
    })
    .reduce((total, request) => {
      const requestDate = new Date(request.timeIn);
      const dayOfWeek = requestDate.getDay(); // 0 = Sunday, 6 = Saturday

      if (dayOfWeek === 0) {
        // Sunday: 2x multiplier
        return total + request.totalHours * 2;
      } else if (dayOfWeek === 6) {
        // Saturday: 1.5x multiplier
        return total + request.totalHours * 1.5;
      } else {
        // Weekday: 1x multiplier
        return total + request.totalHours;
      }
    }, 0);
}

// Helper function to calculate total paid hours with multipliers
function calculatePaidHours(requests) {
  return requests
    .filter(request => request.status === 'ceo-signed-off') // Only count fully approved requests
    .reduce((total, request) => {
      const requestDate = new Date(request.timeIn);
      const dayOfWeek = requestDate.getDay(); // 0 = Sunday, 6 = Saturday

      if (dayOfWeek === 0) {
        // Sunday: 2x multiplier
        return total + request.totalHours * 2;
      } else if (dayOfWeek === 6) {
        // Saturday: 1.5x multiplier
        return total + request.totalHours * 1.5;
      } else {
        // Weekday: 1x multiplier
        return total + request.totalHours;
      }
    }, 0);
}

// CEO: Edit Request
app.post('/requests/:id/edit', authenticate, async (req, res) => {
  const { id } = req.params;
  const { site, duty, vehicle, timeIn, timeOut } = req.body;

  // Check if the user is the CEO
  if (req.user.role !== 'ceo') {
    return res.status(403).send('Only the CEO can edit requests.');
  }

  try {
    // Parse timeIn and timeOut as Date objects
    const timeInDate = new Date(timeIn);
    const timeOutDate = new Date(timeOut);

    // Validate the dates
    if (isNaN(timeInDate.getTime()) || isNaN(timeOutDate.getTime())) {
      return res.status(400).send('Invalid Time In or Time Out.');
    }

    // Calculate total hours
    const totalHours = (timeOutDate - timeInDate) / (1000 * 60 * 60); // Convert milliseconds to hours

    // Update the request
    const request = await Request.findByIdAndUpdate(
      id,
      { site, duty, vehicle, timeIn: timeInDate, timeOut: timeOutDate, totalHours },
      { new: true }
    );

    res.redirect('/dashboard'); // Redirect back to the dashboard
  } catch (err) {
    res.status(400).send(err.message);
  }
});