const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  site: { type: String, required: true },
  duty: { type: String, required: true },
  vehicle: { type: String, required: true },
  timeIn: { type: Date, required: true }, // Time the user clocks in
  timeOut: { type: Date }, // Time the user clocks out
  totalHours: { type: Number }, // Total hours calculated
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the user who created the request
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the admin who approved/rejected
  ceoSignOff: { type: Boolean, default: false }, // CEO's final sign-off
});

module.exports = mongoose.model('Request', requestSchema)