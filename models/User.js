const mongoose = require('mongoose');
const { Schema } = mongoose;

const deductionSchema = new Schema({
  amount: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true,
    enum: ['damage', 'absence', 'error', 'other']
  },
  note: String,
  appliedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  year: Number,
  month: Number
});

const userSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['employee', 'supervisor', 'admin', 'ceo', 'tech'],
    default: 'employee'
  },
  hourlyRate: {
    type: Number,
    default: 0
  },
  deductions: [deductionSchema]
});

module.exports = mongoose.model('User', userSchema);