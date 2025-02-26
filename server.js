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
    
    // Get month and year from query parameters or use current date
    const now = new Date();
    const currentYear = req.query.year ? parseInt(req.query.year) : now.getFullYear();
    const currentMonth = req.query.month ? parseInt(req.query.month) : now.getMonth();
    
    // Calculate previous month
    const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Get all users (for displaying all users with hourly rates for admin/CEO)
    let users = [];
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'tech') {
      users = await User.find().select('username role hourlyRate');
    }

    // Calculate totals and deductions for each user
    for (const userId in requestsByUser) {
      // Add deductions calculations
      // Get all deductions for the user
      const user = await User.findById(userId);
      
      if (user && user.deductions) {
        // Current month deductions
        const currentMonthDeductions = user.deductions.filter(
          deduction => deduction.year === currentYear && deduction.month === currentMonth
        );
        
        const currentMonthDeductionTotal = currentMonthDeductions.reduce(
          (total, deduction) => total + deduction.amount, 0
        );
        
        // Previous month deductions
        const previousMonthDeductions = user.deductions.filter(
          deduction => deduction.year === previousYear && deduction.month === previousMonth
        );
        
        const previousMonthDeductionTotal = previousMonthDeductions.reduce(
          (total, deduction) => total + deduction.amount, 0
        );
        
        // Add to requestsByUser object
        requestsByUser[userId].currentMonthDeductions = currentMonthDeductionTotal;
        requestsByUser[userId].previousMonthDeductions = previousMonthDeductionTotal;
      } else {
        requestsByUser[userId].currentMonthDeductions = 0;
        requestsByUser[userId].previousMonthDeductions = 0;
      }
    }

    // Fetch all requests for admins, supervisors, CEO, and tech
    if (req.user.role === 'admin' || req.user.role === 'supervisor' || req.user.role === 'ceo' || req.user.role === 'tech') {
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

    // Get hourly rates for all users (only for admin/CEO)
    const userHourlyRates = {};
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'tech') {
      const allUsers = await User.find().select('_id hourlyRate');
      allUsers.forEach(user => {
        userHourlyRates[user._id.toString()] = user.hourlyRate;
      });
    }

    // Render the dashboard with the required data
    res.render('dashboard', {
      user: req.user,
      requestsByUser,
      userHourlyRates,
      users,
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

// Update hourly rate for user
app.post('/users/:id/hourly-rate', authenticate, async (req, res) => {
  const { id } = req.params;
  const { hourlyRate } = req.body;

  // Check if the user is admin or CEO
  if (req.user.role !== 'admin' && req.user.role !== 'ceo') {
    return res.status(403).send('Only admins and CEO can update hourly rates.');
  }

  try {
    await User.findByIdAndUpdate(id, { hourlyRate: parseFloat(hourlyRate) });
    res.redirect('/dashboard');
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Edit request (for employee - only pending requests)
app.post('/requests/:id/edit-employee', authenticate, async (req, res) => {
  const { id } = req.params;
  const { site, duty, vehicle, timeIn, timeOut } = req.body;

  try {
    // Find the request
    const request = await Request.findById(id);
    
    // Check if the request exists and belongs to the user
    if (!request || request.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).send('You can only edit your own requests.');
    }
    
    // Check if the request is still pending
    if (request.status !== 'pending') {
      return res.status(403).send('You can only edit pending requests.');
    }

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
    await Request.findByIdAndUpdate(
      id,
      { site, duty, vehicle, timeIn: timeInDate, timeOut: timeOutDate, totalHours },
      { new: true }
    );

    res.redirect('/dashboard');
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Delete request (for employee - only pending requests)
app.post('/requests/:id/delete', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Find the request
    const request = await Request.findById(id);
    
    // Check if the request exists and belongs to the user
    if (!request || request.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).send('You can only delete your own requests.');
    }
    
    // Check if the request is still pending
    if (request.status !== 'pending') {
      return res.status(403).send('You can only delete pending requests.');
    }

    // Delete the request
    await Request.findByIdAndDelete(id);
    res.redirect('/dashboard');
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Print user history (admin feature)
app.get('/users/:id/print/:year/:month', authenticate, async (req, res) => {
  const { id, year, month } = req.params;

  // Check if the user is an admin
  if (req.user.role !== 'admin' && req.user.role !== 'ceo') {
    return res.status(403).send('Only admins and CEO can print user history.');
  }

  try {
    // Get the user
    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).send('User not found.');
    }

    // Get all requests for the user for the specified month
    const startDate = new Date(parseInt(year), parseInt(month), 1);
    const endDate = new Date(parseInt(year), parseInt(month) + 1, 0);

    const requests = await Request.find({
      createdBy: id,
      timeIn: { $gte: startDate, $lte: endDate },
      status: 'ceo-signed-off' // Only include fully approved requests
    }).sort({ timeIn: 1 });

    // Calculate totals
    let totalWorkHours = 0;
    let totalPayHours = 0;

    const plainTextHistory = requests.map(request => {
      const date = request.timeIn.toLocaleDateString();
      const timeIn = request.timeIn.toLocaleTimeString();
      const timeOut = request.timeOut.toLocaleTimeString();
      const hours = request.totalHours.toFixed(2);
      
      const dayOfWeek = request.timeIn.getDay();
      let multiplier = 1;
      if (dayOfWeek === 0) multiplier = 2; // Sunday
      if (dayOfWeek === 6) multiplier = 1.5; // Saturday
      
      const payHours = request.totalHours * multiplier;
      const payAmount = payHours * targetUser.hourlyRate;
      
      totalWorkHours += request.totalHours;
      totalPayHours += payHours;
      
      return `Date: ${date} | Site: ${request.site} | Duty: ${request.duty} | Vehicle: ${request.vehicle} | Time: ${timeIn} - ${timeOut} | Hours: ${hours} | Pay Hours: ${payHours.toFixed(2)} | Amount: $${payAmount.toFixed(2)}`;
    }).join('\n\n');

    const monthName = new Date(parseInt(year), parseInt(month)).toLocaleString('default', { month: 'long' });
    
    const header = `Overtime History for ${targetUser.username}\nMonth: ${monthName} ${year}\nHourly Rate: $${targetUser.hourlyRate.toFixed(2)}\n\n`;
    const footer = `\n\nTotal Work Hours: ${totalWorkHours.toFixed(2)}\nTotal Pay Hours: ${totalPayHours.toFixed(2)}\nTotal Pay Amount: $${(totalPayHours * targetUser.hourlyRate).toFixed(2)}`;
    
    // Set the content type to plain text
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=${targetUser.username}_${monthName}_${year}.txt`);
    res.send(header + plainTextHistory + footer);
  } catch (err) {
    res.status(500).send(err.message);
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

// Tech: Edit Request (can edit any request regardless of status)
app.post('/requests/:id/edit-tech', authenticate, async (req, res) => {
  const { id } = req.params;
  const { site, duty, vehicle, timeIn, timeOut } = req.body;

  // Check if the user is a tech
  if (req.user.role !== 'tech') {
    return res.status(403).send('Only tech users can edit approved requests.');
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

// History page - Show all past requests with filtering options
app.get('/history', authenticate, async (req, res) => {
  try {
    let query = {};
    const { startDate, endDate, status, user } = req.query;
    
    // Apply filters if provided
    if (startDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$gte = new Date(startDate);
    }
    
    if (endDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$lte = new Date(endDate);
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // For employees, only show their own requests
    if (req.user.role === 'employee') {
      query.createdBy = req.user._id;
    } 
    // For admins/CEOs/supervisors who want to filter by user
    else if (user && user !== 'all' && (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor')) {
      query.createdBy = user;
    }
    
    // Get all users (for filtering, visible only to admins, supervisors, and CEO)
    let users = [];
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor') {
      users = await User.find().select('username _id');
    }
    
    const requests = await Request.find(query)
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .sort({ timeIn: -1 });
    
    res.render('history', {
      user: req.user,
      requests,
      users,
      filters: {
        startDate: startDate || '',
        endDate: endDate || '',
        status: status || 'all',
        user: user || 'all'
      }
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Reports page - Generate various reports
app.get('/reports', authenticate, async (req, res) => {
  try {
    // Only admins, CEOs, and tech can access reports
    if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
      return res.status(403).render('error', {
        user: req.user,
        error: 'Access denied. Only admins, CEOs, and tech can access reports.'
      });
      // Alternatively, you can redirect to dashboard:
      // return res.redirect('/dashboard');
    }
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Get all users for the report
    const users = await User.find().select('username _id hourlyRate role');
    
    // Get summary data for each user
    const userSummaries = [];
    for (const user of users) {
      // Get all approved requests for this user
      const requests = await Request.find({
        createdBy: user._id,
        status: 'ceo-signed-off'
      });
      
      // Current month data
      const currentMonthRequests = requests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getFullYear() === currentYear && reqDate.getMonth() === currentMonth;
      });
      
      // Calculate totals
      const totalHours = requests.reduce((sum, req) => sum + req.totalHours, 0);
      
      // Calculate paid hours with multipliers
      const totalPaidHours = requests.reduce((sum, req) => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        return sum + (req.totalHours * multiplier);
      }, 0);
      
      // Calculate pay amount
      const totalPayAmount = totalPaidHours * user.hourlyRate;
      
      // Current month totals
      const currentMonthHours = currentMonthRequests.reduce((sum, req) => sum + req.totalHours, 0);
      const currentMonthPaidHours = currentMonthRequests.reduce((sum, req) => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        return sum + (req.totalHours * multiplier);
      }, 0);
      const currentMonthPayAmount = currentMonthPaidHours * user.hourlyRate;
      
      userSummaries.push({
        user: user,
        totalRequests: requests.length,
        totalHours: totalHours,
        totalPaidHours: totalPaidHours,
        totalPayAmount: totalPayAmount,
        currentMonthRequests: currentMonthRequests.length,
        currentMonthHours: currentMonthHours,
        currentMonthPaidHours: currentMonthPaidHours,
        currentMonthPayAmount: currentMonthPayAmount
      });
    }
    
    // Get site statistics - which sites have the most requests
    const allRequests = await Request.find({ status: 'ceo-signed-off' });
    
    // Group requests by site
    const siteStats = {};
    allRequests.forEach(req => {
      if (!siteStats[req.site]) {
        siteStats[req.site] = {
          count: 0,
          totalHours: 0
        };
      }
      siteStats[req.site].count++;
      siteStats[req.site].totalHours += req.totalHours;
    });
    
    // Convert to array for easier rendering
    const siteStatsArray = Object.keys(siteStats).map(site => ({
      site: site,
      count: siteStats[site].count,
      totalHours: siteStats[site].totalHours
    })).sort((a, b) => b.count - a.count); // Sort by count in descending order
    
    // Monthly trend data for the current year
    const monthlyTrends = [];
    for (let month = 0; month < 12; month++) {
      const monthRequests = allRequests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getFullYear() === currentYear && reqDate.getMonth() === month;
      });
      
      const totalHours = monthRequests.reduce((sum, req) => sum + req.totalHours, 0);
      const totalRequests = monthRequests.length;
      
      monthlyTrends.push({
        month: new Date(currentYear, month).toLocaleString('default', { month: 'long' }),
        requests: totalRequests,
        hours: totalHours
      });
    }
    
    res.render('reports', {
      user: req.user,
      userSummaries: userSummaries,
      siteStats: siteStatsArray,
      monthlyTrends: monthlyTrends,
      currentYear: currentYear
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Generate PDF report
app.get('/reports/generate-pdf', authenticate, async (req, res) => {
  // Only admins, CEOs, and tech can generate PDF reports
  if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
    return res.status(403).send('Access denied. Only admins, CEOs, and tech can generate reports.');
  }
  
  try {
    const { reportType, startDate, endDate, userId } = req.query;
    
    // Based on the report type, generate the appropriate data
    // For simplicity, we'll just return a text report here
    // In a real application, you'd use a library like PDFKit to generate a PDF
    
    const user = userId ? await User.findById(userId) : null;
    
    let query = {};
    if (startDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$gte = new Date(startDate);
    }
    if (endDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$lte = new Date(endDate);
    }
    if (userId) {
      query.createdBy = userId;
    }
    query.status = 'ceo-signed-off'; // Only include fully approved requests
    
    const requests = await Request.find(query)
      .populate('createdBy', 'username')
      .sort({ timeIn: 1 });
    
    // Calculate totals
    let totalWorkHours = 0;
    let totalPayHours = 0;
    let totalPayAmount = 0;
    
    const reportContent = requests.map(request => {
      const date = request.timeIn.toLocaleDateString();
      const timeIn = request.timeIn.toLocaleTimeString();
      const timeOut = request.timeOut.toLocaleTimeString();
      const hours = request.totalHours.toFixed(2);
      
      const dayOfWeek = request.timeIn.getDay();
      let multiplier = 1;
      if (dayOfWeek === 0) multiplier = 2; // Sunday
      if (dayOfWeek === 6) multiplier = 1.5; // Saturday
      
      const payHours = request.totalHours * multiplier;
      const payAmount = user ? payHours * user.hourlyRate : 0;
      
      totalWorkHours += request.totalHours;
      totalPayHours += payHours;
      if (user) totalPayAmount += payAmount;
      
      return `Date: ${date} | Site: ${request.site} | Duty: ${request.duty} | Vehicle: ${request.vehicle} | Time: ${timeIn} - ${timeOut} | Hours: ${hours} | Pay Hours: ${payHours.toFixed(2)}${user ? ` | Amount: $${payAmount.toFixed(2)}` : ''}`;
    }).join('\n\n');
    
    const startDateStr = startDate ? new Date(startDate).toLocaleDateString() : 'All time';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString() : 'Present';
    
    const header = `Overtime Report${user ? ` for ${user.username}` : ''}\nPeriod: ${startDateStr} to ${endDateStr}\n${user ? `Hourly Rate: $${user.hourlyRate.toFixed(2)}\n` : ''}Report Type: ${reportType}\n\n`;
    const footer = `\n\nTotal Work Hours: ${totalWorkHours.toFixed(2)}\nTotal Pay Hours: ${totalPayHours.toFixed(2)}${user ? `\nTotal Pay Amount: $${totalPayAmount.toFixed(2)}` : ''}`;
    
    // Set the content type to plain text for simplicity
    // In a real application, you'd generate a PDF here
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=overtime_report_${new Date().toISOString().slice(0, 10)}.txt`);
    res.send(header + reportContent + footer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// History page - Show all past requests with filtering options
app.get('/history', authenticate, async (req, res) => {
  try {
    let query = {};
    const { startDate, endDate, status, user: userId } = req.query;
    const filters = {
      startDate: startDate || '',
      endDate: endDate || '',
      status: status || 'all',
      user: userId || 'all'
    };
    
    // Apply filters if provided
    if (startDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$gte = new Date(startDate);
    }
    
    if (endDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$lte = new Date(endDate);
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // For employees, only show their own requests
    if (req.user.role === 'employee') {
      query.createdBy = req.user._id;
    } 
    // For admins/CEOs/supervisors who want to filter by user
    else if (userId && userId !== 'all' && (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor')) {
      query.createdBy = userId;
    }
    
    // Get all users (for filtering, visible only to admins, supervisors, and CEO)
    let users = [];
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor' || req.user.role === 'tech') {
      users = await User.find().select('username _id');
    }
    
    const requests = await Request.find(query)
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .sort({ timeIn: -1 });
    
    res.render('history', {
      user: req.user,
      requests,
      users,
      filters
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Reports page - Generate various reports
app.get('/reports', authenticate, async (req, res) => {
  try {
    // Only admins, CEOs, and tech can access reports
    if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
      return res.status(403).send('Access denied. Only admins, CEOs, and tech can access reports.');
    }
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Get all users for the report
    const users = await User.find().select('username _id hourlyRate role');
    
    // Get summary data for each user
    const userSummaries = [];
    for (const user of users) {
      // Get all approved requests for this user
      const requests = await Request.find({
        createdBy: user._id,
        status: 'ceo-signed-off'
      });
      
      // Current month data
      const currentMonthRequests = requests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getFullYear() === currentYear && reqDate.getMonth() === currentMonth;
      });
      
      // Calculate totals
      const totalHours = requests.reduce((sum, req) => sum + req.totalHours, 0);
      
      // Calculate paid hours with multipliers
      const totalPaidHours = requests.reduce((sum, req) => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        return sum + (req.totalHours * multiplier);
      }, 0);
      
      // Calculate pay amount
      const totalPayAmount = totalPaidHours * user.hourlyRate;
      
      // Current month totals
      const currentMonthHours = currentMonthRequests.reduce((sum, req) => sum + req.totalHours, 0);
      const currentMonthPaidHours = currentMonthRequests.reduce((sum, req) => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        return sum + (req.totalHours * multiplier);
      }, 0);
      const currentMonthPayAmount = currentMonthPaidHours * user.hourlyRate;
      
      userSummaries.push({
        user: user,
        totalRequests: requests.length,
        totalHours: totalHours,
        totalPaidHours: totalPaidHours,
        totalPayAmount: totalPayAmount,
        currentMonthRequests: currentMonthRequests.length,
        currentMonthHours: currentMonthHours,
        currentMonthPaidHours: currentMonthPaidHours,
        currentMonthPayAmount: currentMonthPayAmount
      });
    }
    
    // Get site statistics - which sites have the most requests
    const allRequests = await Request.find({ status: 'ceo-signed-off' });
    
    // Group requests by site
    const siteStats = {};
    allRequests.forEach(req => {
      if (!siteStats[req.site]) {
        siteStats[req.site] = {
          count: 0,
          totalHours: 0
        };
      }
      siteStats[req.site].count++;
      siteStats[req.site].totalHours += req.totalHours;
    });
    
    // Convert to array for easier rendering
    const siteStatsArray = Object.keys(siteStats).map(site => ({
      site: site,
      count: siteStats[site].count,
      totalHours: siteStats[site].totalHours
    })).sort((a, b) => b.count - a.count); // Sort by count in descending order
    
    // Monthly trend data for the current year
    const monthlyTrends = [];
    for (let month = 0; month < 12; month++) {
      const monthRequests = allRequests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getFullYear() === currentYear && reqDate.getMonth() === month;
      });
      
      const totalHours = monthRequests.reduce((sum, req) => sum + req.totalHours, 0);
      const totalRequests = monthRequests.length;
      
      monthlyTrends.push({
        month: new Date(currentYear, month).toLocaleString('default', { month: 'long' }),
        requests: totalRequests,
        hours: totalHours
      });
    }
    
    res.render('reports', {
      user: req.user,
      userSummaries: userSummaries,
      siteStats: siteStatsArray,
      monthlyTrends: monthlyTrends,
      currentYear: currentYear
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Export reports as text files or CSV
app.get('/reports/generate-pdf', authenticate, async (req, res) => {
  // Only admins, CEOs, and supervisors can generate reports
  if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'supervisor' && req.user.role !== 'tech') {
    return res.status(403).send('Access denied. Only admins, CEOs, supervisors, and tech can generate reports.');
  }
  
  try {
    const { reportType, startDate, endDate, userId, month, year, site } = req.query;
    
    // Based on the report type, generate the appropriate data
    const user = userId ? await User.findById(userId) : null;
    
    let query = {};
    if (startDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$gte = new Date(startDate);
    }
    if (endDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$lte = new Date(endDate);
    }
    if (userId) {
      query.createdBy = userId;
    }
    if (site && site !== 'all') {
      query.site = site;
    }
    if (month && year) {
      const startOfMonth = new Date(parseInt(year), parseInt(month), 1);
      const endOfMonth = new Date(parseInt(year), parseInt(month) + 1, 0);
      query.timeIn = {
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }
    
    query.status = 'ceo-signed-off'; // Only include fully approved requests
    
    const requests = await Request.find(query)
      .populate('createdBy', 'username')
      .sort({ timeIn: 1 });
    
    // Calculate totals
    let totalWorkHours = 0;
    let totalPayHours = 0;
    let totalPayAmount = 0;
    
    const reportContent = requests.map(request => {
      const date = request.timeIn.toLocaleDateString();
      const timeIn = request.timeIn.toLocaleTimeString();
      const timeOut = request.timeOut.toLocaleTimeString();
      const hours = request.totalHours.toFixed(2);
      
      const dayOfWeek = request.timeIn.getDay();
      let multiplier = 1;
      if (dayOfWeek === 0) multiplier = 2; // Sunday
      if (dayOfWeek === 6) multiplier = 1.5; // Saturday
      
      const payHours = request.totalHours * multiplier;
      const payAmount = user ? payHours * user.hourlyRate : 0;
      
      totalWorkHours += request.totalHours;
      totalPayHours += payHours;
      if (user) totalPayAmount += payAmount;
      
      return `Date: ${date} | Site: ${request.site} | Duty: ${request.duty} | Vehicle: ${request.vehicle} | Time: ${timeIn} - ${timeOut} | Hours: ${hours} | Pay Hours: ${payHours.toFixed(2)}${user ? ` | Amount: $${payAmount.toFixed(2)}` : ''}`;
    }).join('\n\n');
    
    const startDateStr = startDate ? new Date(startDate).toLocaleDateString() : month && year ? new Date(parseInt(year), parseInt(month), 1).toLocaleDateString() : 'All time';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString() : month && year ? new Date(parseInt(year), parseInt(month) + 1, 0).toLocaleDateString() : 'Present';
    
    const header = `Overtime Report${user ? ` for ${user.username}` : ''}${site && site !== 'all' ? ` at ${site}` : ''}\nPeriod: ${startDateStr} to ${endDateStr}\n${user ? `Hourly Rate: $${user.hourlyRate.toFixed(2)}\n` : ''}Report Type: ${reportType}\n\n`;
    const footer = `\n\nTotal Work Hours: ${totalWorkHours.toFixed(2)}\nTotal Pay Hours: ${totalPayHours.toFixed(2)}${user ? `\nTotal Pay Amount: $${totalPayAmount.toFixed(2)}` : ''}`;
    
    // Set the content type to plain text for simplicity
    // In a real application, you'd generate a PDF here
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=overtime_report_${new Date().toISOString().slice(0, 10)}.txt`);
    res.send(header + reportContent + footer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Export user data
app.get('/reports/export-users', authenticate, async (req, res) => {
  // Only admins, CEOs, and tech can export user data
  if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
    return res.status(403).send('Access denied. Only admins, CEOs, and tech can export user data.');
  }
  
  try {
    const users = await User.find().select('username role hourlyRate');
    
    // Format as CSV
    let csvContent = 'Username,Role,Hourly Rate\n';
    users.forEach(user => {
      csvContent += `${user.username},${user.role},${user.hourlyRate.toFixed(2)}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Export history data as CSV
app.get('/history/export', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, status, user: userId, exportFormat } = req.query;
    const includeApproved = req.query.includeApproved === '1';
    const includePending = req.query.includePending === '1';
    
    let query = {};
    
    // Apply filters
    if (startDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$gte = new Date(startDate);
    }
    
    if (endDate) {
      query.timeIn = query.timeIn || {};
      query.timeIn.$lte = new Date(endDate);
    }
    
    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    } else {
      // Apply status inclusion/exclusion
      const statusArray = [];
      if (includeApproved) {
        statusArray.push('supervisor-approved', 'admin-approved', 'ceo-signed-off');
      }
      if (includePending) {
        statusArray.push('pending');
      }
      if (statusArray.length > 0) {
        query.status = { $in: statusArray };
      }
    }
    
    // User filter
    if (req.user.role === 'employee') {
      query.createdBy = req.user._id;
    } else if (userId && userId !== 'all') {
      query.createdBy = userId;
    }
    
    const requests = await Request.find(query)
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .sort({ timeIn: -1 });
    
    if (exportFormat === 'csv') {
      // Format as CSV
      let csvContent = 'Date,Site,Duty,Vehicle,Employee,Time In,Time Out,Hours,Status\n';
      requests.forEach(request => {
        const date = request.timeIn.toLocaleDateString();
        const timeIn = request.timeIn.toLocaleTimeString();
        const timeOut = request.timeOut.toLocaleTimeString();
        const employee = request.createdBy ? request.createdBy.username : 'Deleted User';
        const hours = request.totalHours.toFixed(2);
        
        csvContent += `${date},"${request.site}","${request.duty}","${request.vehicle}",${employee},${timeIn},${timeOut},${hours},${request.status}\n`;
      });
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=overtime_history.csv');
      res.send(csvContent);
    } else {
      // Format as text
      let textContent = 'Overtime Request History\n';
      textContent += `Date Range: ${startDate || 'All time'} to ${endDate || 'Present'}\n\n`;
      
      requests.forEach((request, index) => {
        const date = request.timeIn.toLocaleDateString();
        const timeIn = request.timeIn.toLocaleTimeString();
        const timeOut = request.timeOut.toLocaleTimeString();
        const employee = request.createdBy ? request.createdBy.username : 'Deleted User';
        const hours = request.totalHours.toFixed(2);
        
        textContent += `Request #${index + 1}\n`;
        textContent += `Date: ${date}\n`;
        textContent += `Site: ${request.site}\n`;
        textContent += `Duty: ${request.duty}\n`;
        textContent += `Vehicle: ${request.vehicle}\n`;
        textContent += `Employee: ${employee}\n`;
        textContent += `Time: ${timeIn} - ${timeOut}\n`;
        textContent += `Hours: ${hours}\n`;
        textContent += `Status: ${request.status}\n\n`;
      });
      
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename=overtime_history.txt');
      res.send(textContent);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Add a deduction for a user
app.post('/users/:id/deduction', authenticate, async (req, res) => {
  const { id } = req.params;
  const { deductionAmount, deductionReason, deductionNote, year, month } = req.body;

  // Check if the user is admin or CEO
  if (req.user.role !== 'admin' && req.user.role !== 'ceo') {
    return res.status(403).send('Only admins and CEO can add deductions.');
  }

  try {
    // Find the user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).send('User not found.');
    }

    // Create a new deduction record
    const deduction = {
      amount: parseFloat(deductionAmount),
      reason: deductionReason,
      note: deductionNote,
      appliedBy: req.user._id,
      createdAt: new Date(),
      year: parseInt(year),
      month: parseInt(month)
    };

    // Add the deduction to the user's deductions array
    if (!user.deductions) {
      user.deductions = [];
    }
    
    user.deductions.push(deduction);
    await user.save();

    res.redirect('/dashboard');
  } catch (err) {
    res.status(400).send(err.message);
  }
});