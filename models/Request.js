const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  site: { type: String, required: true },
  duty: { type: String, required: true },
  vehicle: { type: String, required: true },
  timeIn: { type: Date, required: true },
  timeOut: { type: Date, required: true },
  totalHours: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'supervisor-approved', 'admin-approved', 'ceo-signed-off', 'rejected'], 
    default: 'pending' 
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the user who created the request
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the admin who approved/rejected
  ceoSignOff: { type: Boolean, default: false }, // CEO's final sign-off
  createdAt: { type: Date, default: Date.now }, // Track when the request was created
  updatedAt: { type: Date, default: Date.now } // Track when the request was last updated
}, 
{
  timestamps: true // Add timestamps (this will handle the createdAt and updatedAt fields automatically)
});

module.exports = mongoose.model('Request', requestSchema);