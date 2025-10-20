const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  email: { type: String },
  password: { type: String, required: true },
  joinDate: { type: Date, default: Date.now },
  totalCalls: { type: Number, default: 0 },
  totalCallDuration: { type: Number, default: 0 },
  level: { type: String, default: 'beginner' }
});

const callSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  duration: Number,
  callType: { type: String, enum: ['voice', 'text'], default: 'voice' },
  sessionType: { 
    type: String, 
    enum: ['free_conversation', 'grammar_lesson', 'pronunciation'], 
    default: 'free_conversation' 
  },
  mistakes: [{
    original: String,
    corrected: String,
    timestamp: { type: Date, default: Date.now },
    mistakeType: { 
      type: String, 
      enum: ['grammar', 'pronunciation', 'vocabulary', 'accent'] 
    },
    context: String
  }],
  conversation: [{
    speaker: { type: String, enum: ['user', 'ai'] },
    message: String,
    timestamp: { type: Date, default: Date.now },
    hasCorrection: { type: Boolean, default: false },
    correctionData: {
      original: String,
      corrected: String,
      explanation: String
    }
  }],
  overallScore: Number,
  feedback: String
});

const User = mongoose.model('User', userSchema);
const CallSession = mongoose.model('CallSession', callSessionSchema);

module.exports = { User, CallSession };
