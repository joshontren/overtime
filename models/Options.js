const mongoose = require('mongoose');

const optionsSchema = new mongoose.Schema({
  sites: [{ type: String }],
  duties: [{ type: String }],
  vehicles: [{ type: String }],
});

module.exports = mongoose.model('Options', optionsSchema);