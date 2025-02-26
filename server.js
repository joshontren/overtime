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
app.use(express.static(path.join(__dirname, 'public')));

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

// Call the function to connect to the database
connectToDatabase();

// Helper functions for time and pay calculations
function calculateMonthlyWorkHours(requests, year, month) {
  return requests.reduce((total, request) => {
    const requestDate = new Date(request.timeIn);
    if (requestDate.getFullYear() === year && requestDate.getMonth() === month) {
      return total + request.totalHours;
    }
    return total;
  }, 0);
}

function calculateMonthlyPaidHours(requests, year, month) {
  return requests.reduce((total, request) => {
    const requestDate = new Date(request.timeIn);
    if (requestDate.getFullYear() === year && requestDate.getMonth() === month) {
      const dayOfWeek = requestDate.getDay();
      let multiplier = 1;
      if (dayOfWeek === 0) multiplier = 2; // Sunday
      if (dayOfWeek === 6) multiplier = 1.5; // Saturday
      return total + (request.totalHours * multiplier);
    }
    return total;
  }, 0);
}

function calculatePaidHours(requests) {
  return requests.reduce((total, request) => {
    const dayOfWeek = new Date(request.timeIn).getDay();
    let multiplier = 1;
    if (dayOfWeek === 0) multiplier = 2; // Sunday
    if (dayOfWeek === 6) multiplier = 1.5; // Saturday
    return total + (request.totalHours * multiplier);
  }, 0);
}

// Middleware to authenticate
async function authenticate(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, 'SECRET_KEY');
    const user = await User.findById(decoded.userId).select('username role');
    if (!user) return res.redirect('/login');

    req.user = user;
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

    // Get all users based on role
    let users = [];
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'tech') {
      // Only get employees for the hourly rates table
      users = await User.find({ role: 'employee' }).select('username role hourlyRate');
    }

    // Fetch requests based on user role
    if (req.user.role === 'admin' || req.user.role === 'supervisor' || req.user.role === 'ceo' || req.user.role === 'tech') {
      // For admins, fetch all requests
      requests = await Request.find()
        .populate('createdBy', 'username role') // Include role
        .populate('approvedBy', 'username')
        .sort({ timeIn: -1 });

      // Group requests by user
      requests.forEach(request => {
        if (!request.createdBy) {
          // Handle requests where the user was deleted
          const userId = 'deleted-user';
          if (!requestsByUser[userId]) {
            requestsByUser[userId] = {
              username: 'Deleted User',
              role: 'deleted',
              requests: [],
            };
          }
          requestsByUser[userId].requests.push(request);
          return;
        }
        
        // Only include employees in the request grouping
        if (request.createdBy.role === 'employee') {
          const userId = request.createdBy._id.toString();
          if (!requestsByUser[userId]) {
            requestsByUser[userId] = {
              username: request.createdBy.username,
              role: request.createdBy.role,
              requests: [],
            };
          }
          requestsByUser[userId].requests.push(request);
        }
      });
    } 
    // Fetch only the logged-in user's requests for employees
    else if (req.user.role === 'employee') {
      requests = await Request.find({ createdBy: req.user._id })
        .populate('createdBy', 'username')
        .populate('approvedBy', 'username')
        .sort({ timeIn: -1 });

      // Group requests by user (only the logged-in user)
      requestsByUser[req.user._id.toString()] = {
        username: req.user.username,
        role: req.user.role,
        requests,
      };
    }

    // Get hourly rates for all users
    const userHourlyRates = {};
    
    // For employees, only get their own hourly rate
    if (req.user.role === 'employee') {
      const currentUser = await User.findById(req.user._id).select('hourlyRate');
      if (currentUser) {
        userHourlyRates[req.user._id.toString()] = currentUser.hourlyRate || 0;
      }
    } 
    // For admins/CEOs/tech, get all employee hourly rates
    else if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'tech') {
      const allUsers = await User.find({ role: 'employee' }).select('_id hourlyRate');
      allUsers.forEach(user => {
        userHourlyRates[user._id.toString()] = user.hourlyRate || 0;
      });
    }

    // Calculate totals and deductions for each user
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

      // Add deductions calculations
      // This is a critical fix - we need to get deductions for each user
      if (userId !== 'deleted-user') {
        try {
          const user = await User.findById(userId);
          
          if (user && user.deductions && user.deductions.length > 0) {
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
            // Default values if no deductions
            requestsByUser[userId].currentMonthDeductions = 0;
            requestsByUser[userId].previousMonthDeductions = 0;
          }
        } catch (error) {
          console.error(`Error getting deductions for user ${userId}:`, error);
          requestsByUser[userId].currentMonthDeductions = 0;
          requestsByUser[userId].previousMonthDeductions = 0;
        }
      } else {
        // Default values for deleted users
        requestsByUser[userId].currentMonthDeductions = 0;
        requestsByUser[userId].previousMonthDeductions = 0;
      }
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
    console.error("Dashboard error:", err);
    res.status(500).send(err.message);
  }
});

// Homepage
app.get('/', (req, res) => {
  res.render('index');
});

// Login page
app.get('/login', (req, res) => {
  res.render('login');
});

// Registration page
app.get('/register', (req, res) => {
  res.render('register');
});

// Logout
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// User Registration
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).send('Username already exists');
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user with the role set to 'employee'
    const user = new User({ 
      username, 
      password: hashedPassword, 
      role: 'employee', // Default role
      hourlyRate: 0 // Default hourly rate
    });

    await user.save();
    
    // Redirect to login page
    res.redirect('/login');
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
    if (!user) {
      return res.status(400).render('login', { error: 'User not found' });
    }

    // Check the password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).render('login', { error: 'Invalid password' });
    }

    // Generate a JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      'SECRET_KEY',
      { expiresIn: '24h' }
    );
    
    // Set the token in a cookie
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
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

    // Validate that timeOut is after timeIn
    if (timeOutDate <= timeInDate) {
      return res.status(400).send('Time Out must be after Time In.');
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
      createdBy: req.user._id,
      status: 'pending'
    });
    await request.save();
    res.redirect('/dashboard');
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
    const rate = parseFloat(hourlyRate);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).send('Invalid hourly rate');
    }

    await User.findByIdAndUpdate(id, { hourlyRate: rate });
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
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

    // Validate that timeOut is after timeIn
    if (timeOutDate <= timeInDate) {
      return res.status(400).send('Time Out must be after Time In.');
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

// Delete request (for employee - only pending requests, or tech - any request)
app.post('/requests/:id/delete', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Find the request
    const request = await Request.findById(id);
    
    // Check if the request exists
    if (!request) {
      return res.status(404).send('Request not found.');
    }
    
    // Check if user has permission to delete
    if (req.user.role === 'employee') {
      // Employees can only delete their own pending requests
      if (request.createdBy.toString() !== req.user._id.toString()) {
        return res.status(403).send('You can only delete your own requests.');
      }
      
      if (request.status !== 'pending') {
        return res.status(403).send('You can only delete pending requests.');
      }
    } else if (req.user.role !== 'tech') {
      // Only employees or tech can delete requests
      return res.status(403).send('Only employees can delete their pending requests, or tech can delete any request.');
    }

    // Delete the request
    await Request.findByIdAndDelete(id);
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(400).send(err.message);
  }
});

// Print user history (admin feature)
app.get('/users/:id/print/:year/:month', authenticate, async (req, res) => {
  const { id, year, month } = req.params;

  // Check if the user is an admin or CEO
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

    // Get deductions for the user for the specified month
    const deductions = targetUser.deductions ? targetUser.deductions.filter(
      d => d.year === parseInt(year) && d.month === parseInt(month)
    ) : [];

    // Calculate totals
    let totalWorkHours = 0;
    let totalPayHours = 0;
    let totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

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

    // Add deductions section
    let deductionsText = '';
    if (deductions.length > 0) {
      deductionsText = '\n\nDeductions:\n';
      deductions.forEach(d => {
        deductionsText += `Amount: $${d.amount.toFixed(2)} | Reason: ${d.reason} | Note: ${d.note || 'N/A'}\n`;
      });
    }

    const monthName = new Date(parseInt(year), parseInt(month)).toLocaleString('default', { month: 'long' });
    
    const header = `Overtime History for ${targetUser.username}\nMonth: ${monthName} ${year}\nHourly Rate: $${targetUser.hourlyRate.toFixed(2)}\n\n`;
    const footer = `\n\nTotal Work Hours: ${totalWorkHours.toFixed(2)}\nTotal Pay Hours: ${totalPayHours.toFixed(2)}\nGross Pay Amount: $${(totalPayHours * targetUser.hourlyRate).toFixed(2)}\nTotal Deductions: $${totalDeductions.toFixed(2)}\nNet Pay Amount: $${((totalPayHours * targetUser.hourlyRate) - totalDeductions).toFixed(2)}`;
    
    // Set the content type to plain text
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=${targetUser.username}_${monthName}_${year}.txt`);
    res.send(header + plainTextHistory + deductionsText + footer);
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
    await Request.findByIdAndUpdate(
      id,
      { status: 'supervisor-approved', approvedBy: req.user._id },
      { new: true }
    );
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
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
    await Request.findByIdAndUpdate(
      id,
      { status: 'admin-approved', approvedBy: req.user._id },
      { new: true }
    );
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
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
    await Request.findByIdAndUpdate(
      id,
      { status: 'ceo-signed-off', ceoSignOff: true },
      { new: true }
    );
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(400).send(err.message);
  }
});

// Tech: Edit Request (can edit any request regardless of status)
app.post('/requests/:id/edit-tech', authenticate, async (req, res) => {
  const { id } = req.params;
  const { site, duty, vehicle, timeIn, timeOut, status } = req.body;

  // Check if the user is a tech
  if (req.user.role !== 'tech') {
    return res.status(403).send('Only tech users can edit any request.');
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
    await Request.findByIdAndUpdate(
      id,
      { 
        site, 
        duty, 
        vehicle, 
        timeIn: timeInDate, 
        timeOut: timeOutDate, 
        totalHours,
        status: status || 'pending' // Allow tech to change status
      },
      { new: true }
    );

    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(400).send(err.message);
  }
});

// Batch approve requests for a user
app.post('/users/:userId/batch-approve', authenticate, async (req, res) => {
  const { userId } = req.params;
  const { action } = req.body; // 'supervisor-approve', 'admin-approve', or 'ceo-signoff'
  
  try {
    let statusUpdate;
    let query = { createdBy: userId };
    
    // Check user role and set appropriate status update
    if (action === 'supervisor-approve' && req.user.role === 'supervisor') {
      statusUpdate = 'supervisor-approved';
      query.status = 'pending';
    } else if (action === 'admin-approve' && req.user.role === 'admin') {
      statusUpdate = 'admin-approved';
      query.status = 'supervisor-approved';
    } else if (action === 'ceo-signoff' && req.user.role === 'ceo') {
      statusUpdate = 'ceo-signed-off';
      query.status = 'admin-approved';
    } else {
      return res.status(403).send('Unauthorized action or invalid status update');
    }
    
    // Update all eligible requests for the user
    const result = await Request.updateMany(
      query,
      { 
        status: statusUpdate,
        approvedBy: req.user._id,
        ...(statusUpdate === 'ceo-signed-off' ? { ceoSignOff: true } : {})
      }
    );
    
    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ 
        success: true, 
        message: `Updated ${result.modifiedCount} requests` 
      });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(400).send(err.message);
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
    // Validate deduction amount
    const amount = parseFloat(deductionAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).send('Invalid deduction amount. Must be a positive number.');
    }

    // Validate year and month
    const parsedYear = parseInt(year);
    const parsedMonth = parseInt(month);
    if (isNaN(parsedYear) || isNaN(parsedMonth) || 
        parsedMonth < 0 || parsedMonth > 11) {
      return res.status(400).send('Invalid year or month.');
    }

    // Find the user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).send('User not found.');
    }

    // Create a new deduction record
    const deduction = {
      amount: amount,
      reason: deductionReason,
      note: deductionNote,
      appliedBy: req.user._id,
      createdAt: new Date(),
      year: parsedYear,
      month: parsedMonth
    };

    // Initialize deductions array if it doesn't exist
    if (!user.deductions) {
      user.deductions = [];
    }
    
    // Add the new deduction
    user.deductions.push(deduction);
    await user.save();

    // Return JSON response for AJAX requests
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    console.error("Error adding deduction:", err);
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(400).send(err.message);
  }
});

// History page - Show all past requests with filtering options
app.get('/history', authenticate, async (req, res) => {
  try {
    let query = {};
    const { startDate, endDate, status, user: userId } = req.query;
    
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
    else if (userId && userId !== 'all' && (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor' || req.user.role === 'tech')) {
      query.createdBy = userId;
    }
    
    // Get all users (for filtering, visible only to admins, supervisors, CEO, and tech)
    let users = [];
    if (req.user.role === 'admin' || req.user.role === 'ceo' || req.user.role === 'supervisor' || req.user.role === 'tech') {
      // Only get employees for filtering
      users = await User.find({ role: 'employee' }).select('username _id');
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
        user: userId || 'all'
      }
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Reports page - Show analytics and generate reports
app.get('/reports', authenticate, async (req, res) => {
  // Only admin, CEO, and tech can access reports
  if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
    return res.status(403).redirect('/dashboard');
  }
  
  try {
    const currentYear = new Date().getFullYear();
    
    // Get all employees
    const users = await User.find({ role: 'employee' }).select('username _id role hourlyRate');
    
    // Get all approved (ceo-signed-off) requests
    const approvedRequests = await Request.find({ status: 'ceo-signed-off' })
      .populate('createdBy', 'username role hourlyRate')
      .sort({ timeIn: -1 });
    
    // Prepare user summaries
    const userSummaries = [];
    const currentMonth = new Date().getMonth();
    
    for (const user of users) {
      const userRequests = approvedRequests.filter(req => 
        req.createdBy && req.createdBy._id.toString() === user._id.toString()
      );
      
      // Current month requests
      const currentMonthRequests = userRequests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getMonth() === currentMonth && reqDate.getFullYear() === currentYear;
      });
      
      // Calculate total hours and paid hours
      let totalHours = 0;
      let totalPaidHours = 0;
      let currentMonthHours = 0;
      let currentMonthPaidHours = 0;
      
      userRequests.forEach(req => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        
        totalHours += req.totalHours;
        totalPaidHours += (req.totalHours * multiplier);
      });
      
      currentMonthRequests.forEach(req => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        
        currentMonthHours += req.totalHours;
        currentMonthPaidHours += (req.totalHours * multiplier);
      });
      
      userSummaries.push({
        user: user,
        totalRequests: userRequests.length,
        totalHours: totalHours,
        totalPaidHours: totalPaidHours,
        totalPayAmount: totalPaidHours * user.hourlyRate,
        currentMonthRequests: currentMonthRequests.length,
        currentMonthHours: currentMonthHours,
        currentMonthPaidHours: currentMonthPaidHours,
        currentMonthPayAmount: currentMonthPaidHours * user.hourlyRate
      });
    }
    
    // Get monthly trends
    const monthlyTrends = [];
    for (let month = 0; month < 12; month++) {
      const monthRequests = approvedRequests.filter(req => {
        const reqDate = new Date(req.timeIn);
        return reqDate.getMonth() === month && reqDate.getFullYear() === currentYear;
      });
      
      let totalHours = 0;
      monthRequests.forEach(req => {
        totalHours += req.totalHours;
      });
      
      monthlyTrends.push({
        month: new Date(currentYear, month).toLocaleString('default', { month: 'short' }),
        requests: monthRequests.length,
        hours: totalHours.toFixed(2)
      });
    }
    
    // Get site statistics
    const siteMap = new Map();
    approvedRequests.forEach(req => {
      if (!siteMap.has(req.site)) {
        siteMap.set(req.site, { site: req.site, count: 0, totalHours: 0 });
      }
      
      const siteData = siteMap.get(req.site);
      siteData.count += 1;
      siteData.totalHours += req.totalHours;
    });
    
    const siteStats = Array.from(siteMap.values())
      .sort((a, b) => b.totalHours - a.totalHours); // Sort by total hours
    
    res.render('reports', {
      user: req.user,
      userSummaries,
      monthlyTrends,
      siteStats,
      currentYear
    });
  } catch (err) {
    console.error("Reports error:", err);
    res.status(500).send(err.message);
  }
});

// Export users data as CSV
app.get('/reports/export-users', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'ceo' && req.user.role !== 'tech') {
    return res.status(403).send('Unauthorized');
  }
  
  try {
    const users = await User.find({ role: 'employee' }).select('username role hourlyRate');
    
    // Get all approved requests
    const approvedRequests = await Request.find({ status: 'ceo-signed-off' })
      .populate('createdBy', 'username');
    
    // CSV Header
    let csv = 'Username,Role,Hourly Rate,Total Requests,Total Hours,Total Paid Hours,Total Pay Amount\n';
    
    // Add rows for each user
    for (const user of users) {
      const userRequests = approvedRequests.filter(req => 
        req.createdBy && req.createdBy._id.toString() === user._id.toString()
      );
      
      // Calculate totals
      let totalHours = 0;
      let totalPaidHours = 0;
      
      userRequests.forEach(req => {
        const dayOfWeek = new Date(req.timeIn).getDay();
        let multiplier = 1;
        if (dayOfWeek === 0) multiplier = 2; // Sunday
        if (dayOfWeek === 6) multiplier = 1.5; // Saturday
        
        totalHours += req.totalHours;
        totalPaidHours += (req.totalHours * multiplier);
      });
      
      const totalPayAmount = totalPaidHours * user.hourlyRate;
      
      // Add row to CSV
      csv += `"${user.username}","${user.role}",${user.hourlyRate.toFixed(2)},${userRequests.length},${totalHours.toFixed(2)},${totalPaidHours.toFixed(2)},${totalPayAmount.toFixed(2)}\n`;
    }
    
    // Set headers and send CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    res.send(csv);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).send(err.message);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});