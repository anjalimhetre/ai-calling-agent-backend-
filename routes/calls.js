const express = require('express');
const { CallSession, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// AI Service Class
class AICallingAgent {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.baseURL = 'https://api.openai.com/v1';
  }

  async processUserInput(userInput, context = [], sessionType = 'free_conversation') {
    let systemPrompt = '';

    switch(sessionType) {
      case 'grammar_lesson':
        systemPrompt = `You are a professional English grammar tutor. Your role:
          1. Have natural conversations while focusing on grammar correction
          2. When user makes grammar mistakes, immediately provide gentle correction
          3. Format: "I think you meant: [corrected version]. The grammar rule here is [brief explanation]"
          4. Keep the conversation flowing naturally
          5. Encourage the user and provide positive reinforcement`;
        break;
      case 'pronunciation':
        systemPrompt = `You are an English pronunciation coach. Your role:
          1. Focus on pronunciation and accent improvement
          2. When you detect pronunciation issues, provide phonetic guidance
          3. Format: "I heard: [what you heard]. The standard pronunciation is: [correct pronunciation]"
          4. Give tips on mouth positioning and stress patterns
          5. Be encouraging and patient`;
        break;
      default:
        systemPrompt = `You are a friendly AI English practice partner. Your role:
          1. Have natural, engaging conversations in English
          2. Immediately correct any grammar, pronunciation, or vocabulary mistakes
          3. For grammar: "I think you meant: [corrected version]"
          4. For pronunciation: "The standard pronunciation is: [correct pronunciation]"
          5. Keep corrections brief and continue the conversation naturally
          6. Always be encouraging and supportive`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...context.slice(-8),
      { role: "user", content: userInput }
    ];

    try {
      const response = await axios.post(`${this.baseURL}/chat/completions`, {
        model: "gpt-3.5-turbo",
        messages: messages,
        max_tokens: 200,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        response: response.data.choices[0].message.content,
        usage: response.data.usage
      };
    } catch (error) {
      console.error('AI API Error:', error.response?.data || error.message);
      return {
        response: "I'm sorry, I'm having trouble processing that. Could you please repeat or rephrase?",
        error: true
      };
    }
  }

  extractCorrection(aiResponse, userInput) {
    const correctionPatterns = [
      /I think you meant:\s*"([^"]+)"/i,
      /The correct way is:\s*"([^"]+)"/i,
      /You should say:\s*"([^"]+)"/i,
      /Standard pronunciation:\s*"([^"]+)"/i
    ];

    for (let pattern of correctionPatterns) {
      const match = aiResponse.match(pattern);
      if (match) {
        return {
          hasCorrection: true,
          corrected: match[1],
          original: userInput,
          explanation: aiResponse
        };
      }
    }

    return {
      hasCorrection: false,
      corrected: null,
      original: userInput,
      explanation: null
    };
  }
}

const aiAgent = new AICallingAgent();

// Start Call Session
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { callType = 'voice', sessionType = 'free_conversation' } = req.body;

    const callSession = new CallSession({
      userId: req.user.userId,
      callType,
      sessionType
    });

    await callSession.save();

    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { totalCalls: 1 }
    });

    res.json({
      sessionId: callSession._id,
      message: 'Call session started',
      callType,
      sessionType
    });
  } catch (error) {
    console.error('Start call error:', error);
    res.status(500).json({ error: 'Failed to start call session' });
  }
});

// Process User Message
router.post('/process', authenticateToken, async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    const session = await CallSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const context = session.conversation.map(msg => ({
      role: msg.speaker === 'user' ? 'user' : 'assistant',
      content: msg.message
    }));

    const aiResponse = await aiAgent.processUserInput(message, context, session.sessionType);
    const correction = aiAgent.extractCorrection(aiResponse.response, message);

    // Save user message
    session.conversation.push({
      speaker: 'user',
      message: message,
      hasCorrection: correction.hasCorrection,
      correctionData: correction.hasCorrection ? {
        original: correction.original,
        corrected: correction.corrected,
        explanation: correction.explanation
      } : undefined
    });

    // Save AI response
    session.conversation.push({
      speaker: 'ai',
      message: aiResponse.response
    });

    // Add to mistakes if correction found
    if (correction.hasCorrection) {
      session.mistakes.push({
        original: correction.original,
        corrected: correction.corrected,
        mistakeType: 'grammar',
        context: message
      });
    }

    await session.save();

    res.json({
      response: aiResponse.response,
      hasCorrection: correction.hasCorrection,
      correction: correction.hasCorrection ? {
        original: correction.original,
        corrected: correction.corrected,
        explanation: correction.explanation
      } : null
    });
  } catch (error) {
    console.error('Process message error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// End Call Session
router.post('/end', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await CallSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.endTime = new Date();
    session.duration = Math.floor((session.endTime - session.startTime) / 1000);

    // Calculate session score
    const totalMessages = session.conversation.filter(msg => msg.speaker === 'user').length;
    const mistakeRate = totalMessages > 0 ? session.mistakes.length / totalMessages : 0;
    session.overallScore = Math.max(0, 100 - (mistakeRate * 100));

    // Generate feedback
    if (session.mistakes.length > 0) {
      const commonMistakes = session.mistakes.slice(0, 3);
      session.feedback = `Great job! You had ${session.mistakes.length} corrections. Focus on: ${commonMistakes.map(m => m.original + ' → ' + m.corrected).join(', ')}`;
    } else {
      session.feedback = 'Excellent conversation! Your English is very good.';
    }

    await session.save();

    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { totalCallDuration: session.duration }
    });

    res.json({
      message: 'Call session ended',
      duration: session.duration,
      mistakesCount: session.mistakes.length,
      overallScore: session.overallScore,
      feedback: session.feedback
    });
  } catch (error) {
    console.error('End call error:', error);
    res.status(500).json({ error: 'Failed to end call session' });
  }
});

module.exports = router;
