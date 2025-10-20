const express = require('express');
const { User, CallSession } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get User Dashboard
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const sessions = await CallSession.find({ userId: req.user.userId })
      .sort({ startTime: -1 })
      .limit(10);

    const totalSessions = await CallSession.countDocuments({ userId: req.user.userId });
    
    const totalMistakesResult = await CallSession.aggregate([
      { $match: { userId: user._id } },
      { $project: { mistakesCount: { $size: "$mistakes" } } },
      { $group: { _id: null, total: { $sum: "$mistakesCount" } } }
    ]);

    const commonMistakes = await CallSession.aggregate([
      { $match: { userId: user._id } },
      { $unwind: "$mistakes" },
      { $group: {
          _id: {
            original: "$mistakes.original",
            corrected: "$mistakes.corrected"
          },
          count: { $sum: 1 },
          lastOccurred: { $max: "$mistakes.timestamp" }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const weeklyProgress = await CallSession.aggregate([
      {
        $match: {
          userId: user._id,
          startTime: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            week: { $week: "$startTime" },
            year: { $year: "$startTime" }
          },
          sessions: { $sum: 1 },
          totalDuration: { $sum: "$duration" },
          mistakes: { $sum: { $size: "$mistakes" } }
        }
      },
      { $sort: { "_id.year": 1, "_id.week": 1 } }
    ]);

    res.json({
      user: {
        name: user.name,
        phoneNumber: user.phoneNumber,
        totalCalls: user.totalCalls,
        totalCallDuration: user.totalCallDuration,
        level: user.level
      },
      stats: {
        totalSessions,
        totalMistakes: totalMistakesResult[0]?.total || 0,
        avgSessionDuration: user.totalCalls > 0 ? Math.round(user.totalCallDuration / user.totalCalls) : 0,
        currentWeekSessions: weeklyProgress[weeklyProgress.length - 1]?.sessions || 0
      },
      recentSessions: sessions.map(s => ({
        id: s._id,
        startTime: s.startTime,
        duration: s.duration,
        mistakesCount: s.mistakes.length,
        overallScore: s.overallScore,
        sessionType: s.sessionType
      })),
      commonMistakes: commonMistakes.map(m => ({
        original: m._id.original,
        corrected: m._id.corrected,
        frequency: m.count,
        lastOccurred: m.lastOccurred
      })),
      weeklyProgress
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Get Session Details
router.get('/session/:sessionId', authenticateToken, async (req, res) => {
  try {
    const session = await CallSession.findById(req.params.sessionId);
    
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      session: {
        id: session._id,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        callType: session.callType,
        sessionType: session.sessionType,
        overallScore: session.overallScore,
        feedback: session.feedback,
        conversation: session.conversation,
        mistakes: session.mistakes
      }
    });
  } catch (error) {
    console.error('Session details error:', error);
    res.status(500).json({ error: 'Failed to load session details' });
  }
});

module.exports = router;
