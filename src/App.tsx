import React, { useState, useRef, useEffect } from 'react';
import parseLLMJson from './utils/jsonParser';

interface Flashcard {
  question: string;
  answer: string;
}

interface MCQ {
  question: string;
  options: string[];
  correctAnswer: string;
}

interface MockTestQuestion extends MCQ {
  explanation: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type MaterialType = 'flashcards' | 'mcqs' | 'mocktest';

// Agent IDs per PRD specification
const STUDY_AGENT_ID = '68e525691cb4a3eb612e3d32';
const TUTOR_AGENT_ID = '68e525750cde5ffc91eee6ea';
const API_KEY = 'sk-default-obhGvAo6gG9YT9tu6ChjyXLqnw7TxSGY';

// Color palette per PRD requirement
const COLORS = {
  primary: '#2979FF',
  secondary: '#FFD600',
  success: '#43A047',
  warning: '#FFB300',
  error: '#E53935',
  info: '#0288D1',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  text: '#212121'
};

function App() {
  const [notes, setNotes] = useState<string>('');
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialType | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [mockTest, setMockTest] = useState<MockTestQuestion[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeFlashcard, setActiveFlashcard] = useState<number>(0);
  const [mcqAnswers, setMcqAnswers] = useState<{[key: number]: string}>({});
  const [showResults, setShowResults] = useState<boolean>(false);
  const [currentQuizPage, setCurrentQuizPage] = useState<number>(1);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const generateRandomString = () => Math.random().toString(36).substring(2, 15);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setNotes(e.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setNotes(prev => prev + text);
    } catch (err) {
      alert('Could not access clipboard. Please paste manually.');
    }
  };

  const clearNotes = () => {
    setNotes('');
    setFlashcards([]);
    setMcqs([]);
    setMockTest([]);
    setSelectedMaterial(null);
    setActiveFlashcard(0);
    setMcqAnswers({});
    setShowResults(false);
  };

  const generateStudyMaterial = async (type: MaterialType) => {
    if (!notes.trim()) {
      alert('Please upload or paste notes first.');
      return;
    }

    setLoading(true);
    setSelectedMaterial(type);

    try {
      const userId = `user${Date.now()}@test.com`;
      const sessionId = `session${Date.now()}`;

      let agentMessage;
      switch (type) {
        case 'flashcards':
          agentMessage = `Generate exactly 8 flashcards from these notes: ${notes}

Format: Return ONLY a JSON array.
[
  {"question": "Q1?", "answer": "A1"},
  {"question": "Q2?", "answer": "A2"}
]
No markdown, no explanations, just JSON.`;
          break;
        case 'mcqs':
          agentMessage = `Generate exactly 8 multiple choice questions from these notes: ${notes}

Format: Return ONLY a JSON array.
[
  {
    "question": "Q1?",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": "A"
  }
]
No markdown, no explanations, just JSON.`;
          break;
        case 'mocktest':
          agentMessage = `Generate exactly 10 questions (mixed Q-A Q-TF Q-MCQ) from these notes: ${notes}

Format: Return ONLY a JSON array.
[
  {
    "question": "Q1?",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": "A",
    "explanation": "Because..."
  }
]
No markdown, no explanations, just JSON.`;
          break;
      }

      const response = await fetch('https://agent-prod.studio.lyzr.ai/v3/inference/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          user_id: userId,
          agent_id: STUDY_AGENT_ID,
          session_id: sessionId,
          message: agentMessage,
        }),
      });

      const data = await response.json();
      const content = data.response || data.message || data.content;

      if (!content) {
        throw new Error('Study agent returned empty response');
      }

      let parsedData;
      try {
        parsedData = parseLLMJson(content);
      } catch (e) {
        // Try extracting JSON from markdown
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedData = parseLLMJson(jsonMatch[1]);
        } else {
          // Try fallback parsing
          parsedData = await parseAgentContent(content, type);
        }
      }

      if (type === 'flashcards') {
        const result = Array.isArray(parsedData) ? parsedData : parsedData.flashcards || [];
        setFlashcards(result);
      } else if (type === 'mcqs') {
        const result = Array.isArray(parsedData) ? parsedData : parsedData.mcqs || [];
        setMcqs(result);
      } else if (type === 'mocktest') {
        const result = Array.isArray(parsedData) ? parsedData : parsedData.mockTest || [];
        setMockTest(result);
      }

    } catch (error) {
      console.error('Study material agent error:', error);
      const demoData = await generateDemoData(type);

      if (type === 'flashcards') setFlashcards(demoData);
      else if (type === 'mcqs') setMcqs(demoData);
      else if (type === 'mocktest') setMockTest(demoData);

      alert('Agent not responding. Generated demo materials for testing.');
    } finally {
      setLoading(false);
    }
  };

  const parseAgentContent = async (content: string, type: MaterialType): Promise<any[]> => {
    try {
      // Try direct JSON parsing first
      return JSON.parse(content);
    } catch {
      // Fallback: Extract structured data from text
      return await extractFromText(content, type);
    }
  };

  const extractFromText = async (content: string, type: MaterialType): Promise<any[]> => {
    const items: any[] = [];

    if (type === 'flashcards') {
      const lines = content.split('\n');
      let current = {} as Flashcard;

      for (const line of lines) {
        const clean = line.trim();
        if (clean.match(/^Question[:\-]/i)) {
          current.question = clean.replace(/^Question[:\-]\s*/i, '');
        } else if (clean.match(/^Answer[:\-]/i)) {
          current.answer = clean.replace(/^Answer[:\-]\s*/i, '');
          if (current.question && current.answer) {
            items.push({ ...current });
            current = {} as Flashcard;
          }
        }
      }
      return items.length > 0 ? items : generateDemoData('flashcards');
    }

    return [];
  };

  const generateDemoData = async (type: MaterialType): Promise<any[]> => {
    if (type === 'flashcards') {
      return [
        { question: "What is the main concept?", answer: "The primary idea from your notes" },
        { question: "Why is this important?", answer: "It helps understand the subject" },
        { question: "When should this be applied?", answer: "During study and practice sessions" },
        { question: "Who can benefit?", answer: "Students learning this topic" }
      ];
    }

    if (type === 'mcqs') {
      return [
        {
          question: "What is the purpose of these notes?",
          options: ["Study", "Entertainment", "Communication", "Analysis"],
          correctAnswer: "Study"
        },
        {
          question: "How should you use this material?",
          options: ["Active review", "Passive reading", "Skip difficult parts", "Look for answers"],
          correctAnswer: "Active review"
        }
      ];
    }

    if (type === 'mocktest') {
      return [
        {
          question: "What learning method is most effective?",
          options: ["Spaced repetition", "Cramming", "Reading once", "Watching videos"],
          correctAnswer: "Spaced repetition",
          explanation: "Reviewing material at increasing intervals strengthens long-term memory."
        }
      ];
    }

    return [];
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !notes.trim()) {
      if (!notes.trim()) alert('Please upload or paste notes first.');
      return;
    }

    const userMessage: ChatMessage = {
      id: generateRandomString(),
      role: 'user',
      content: chatInput,
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await fetch('https://agent-prod.studio.lyzr.ai/v3/inference/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          user_id: `user${Date.now()}@test.com`,
          agent_id: TUTOR_AGENT_ID,
          session_id: `tutor-${Date.now()}`,
          message: `Based on these notes: ${notes}\n\nStudent question: ${chatInput}\n\nProvide a concise explanation that directly answers the question and references relevant parts of the notes.`,
        }),
      });

      const data = await response.json();
      const content = data.response || data.message || data.content || 'Thinking about that...';

      const assistantMessage: ChatMessage = {
        id: generateRandomString(),
        role: 'assistant',
        content: content,
        timestamp: new Date(),
      };

      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Tutor agent error:', error);
      setChatMessages(prev => [...prev, {
        id: generateRandomString(),
        role: 'assistant',
        content: 'I\'m having trouble connecting to the AI tutor right now. Please try again later.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const downloadMaterials = () => {
    if (!selectedMaterial) return;

    let content = '';
    let filename = '';

    if (selectedMaterial === 'flashcards') {
      filename = 'study_flashcards.txt';
      flashcards.forEach((card, index) => {
        content += `Flashcard ${index + 1}: ${card.question}\nAnswer: ${card.answer}\n\n`;
      });
    } else if (selectedMaterial === 'mcqs') {
      filename = 'study_mcqs.txt';
      mcqs.forEach((mcq, index) => {
        content += `Question ${index + 1}: ${mcq.question}\n`;
        mcq.options.forEach((opt, idx) => {
          content += `${String.fromCharCode(65 + idx)}. ${opt}\n`;
        });
        content += `Correct answer: ${mcq.correctAnswer}\n\n`;
      });
    } else if (selectedMaterial === 'mocktest') {
      filename = 'study_mocktest.txt';
      mockTest.forEach((q, index) => {
        content += `Question ${index + 1}: ${q.question}\n`;
        q.options.forEach((opt, idx) => {
          content += `${String.fromCharCode(65 + idx)}. ${opt}\n`;
        });
        content += `Correct answer: ${q.correctAnswer}\nExplanation: ${q.explanation}\n\n`;
      });
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderFlashcardView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">
          Flashcard {activeFlashcard + 1} of {flashcards.length}
        </span>
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveFlashcard(Math.max(0, activeFlashcard - 1))}
            disabled={activeFlashcard === 0}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <button
            onClick={() => setActiveFlashcard(Math.min(flashcards.length - 1, activeFlashcard + 1))}
            disabled={activeFlashcard === flashcards.length - 1}
            className="px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-8 relative overflow-hidden">
        <div className="z-10 relative">
          <div className="text-center">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Question</h3>
              <p className="text-lg text-gray-700 leading-relaxed">{flashcards[activeFlashcard].question}</p>
            </div>

            <button
              onClick={(e) => {
                const answer = e.currentTarget.nextElementSibling as HTMLElement;
                if (answer.style.display === 'none' || !answer.style.display) {
                  answer.style.display = 'block';
                } else {
                  answer.style.display = 'none';
                }
              }}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium transition-colors mb-6"
            >
              Show Answer
            </button>

            <div style={{ display: 'none' }}>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Answer</h3>
              <p className="text-lg text-gray-700 leading-relaxed">{flashcards[activeFlashcard].answer}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMCQView = () => (
    <div className="space-y-6">
      {mcqs.map((mcq, index) => (
        <div key={index} className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            {index + 1}. {mcq.question}
          </h3>
          <div className="space-y-3 mb-4">
            {mcq.options.map((option, optIndex) => (
              <label key={optIndex} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer border border-transparent hover:border-blue-200 transition-colors">
                <input
                  type="radio"
                  name={`mcq-${index}`}
                  value={option}
                  checked={mcqAnswers[index] === option}
                  onChange={() => setMcqAnswers(prev => ({ ...prev, [index]: option }))}
                  className="w-4 h-4 text-blue-500 focus:ring-blue-400"
                />
                <span className="text-gray-800 flex-1">{option}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between bg-white rounded-xl shadow-lg p-6">
        <button
          onClick={() => setShowResults(true)}
          disabled={Object.keys(mcqAnswers).length < mcqs.length}
          className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Submit Quiz
        </button>

        <span className="text-sm text-gray-600 font-medium">
          Answered: {Object.keys(mcqAnswers).length} / {mcqs.length}
        </span>
      </div>

      {showResults && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Quiz Results</h3>
          <div className="space-y-3">
            {mcqs.map((mcq, index) => (
              <div key={index} className="flex items-center space-x-3 p-3 rounded-lg">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                  mcqAnswers[index] === mcq.correctAnswer ? 'bg-green-500' : 'bg-red-500'
                }`}>
                  {mcqAnswers[index] === mcq.correctAnswer ? '✓' : '✗'}
                </div>
                <span className={`text-sm font-medium ${
                  mcqAnswers[index] === mcq.correctAnswer ? 'text-green-600' : 'text-red-600'
                }`}>
                  Question {index + 1}: {mcqAnswers[index] === mcq.correctAnswer ? 'Correct' : 'Incorrect'}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setShowResults(false);
              setMcqAnswers({});
              setCurrentQuizPage(1);
            }}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Retake Quiz
          </button>
        </div>
      )}
    </div>
  );

  const renderMockTestView = () => {
    const startIndex = (currentQuizPage - 1) * 5;
    const currentQuestions = mockTest.slice(startIndex, startIndex + 5);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-white rounded-xl shadow-lg p-4">
          <span className="text-sm font-medium text-gray-600">
            Questions {startIndex + 1}-{Math.min(startIndex + 5, mockTest.length)} of {mockTest.length}
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => setCurrentQuizPage(Math.max(1, currentQuizPage - 1))}
              disabled={currentQuizPage === 1}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Previous
            </button>
            <button
              onClick={() => setCurrentQuizPage(Math.min(Math.ceil(mockTest.length / 5), currentQuizPage + 1))}
              disabled={currentQuizPage >= Math.ceil(mockTest.length / 5)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>

        {currentQuestions.map((question, index) => (
          <div key={startIndex + index} className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {startIndex + index + 1}. {question.question}
            </h3>
            <div className="space-y-3 mb-6">
              {question.options.map((option, optIndex) => (
                <label key={optIndex} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer border border-transparent hover:border-blue-200 transition-colors">
                  <input
                    type="radio"
                    name={`mock-q-${startIndex + index}`}
                    value={option}
                    className="w-4 h-4 text-blue-500 focus:ring-blue-400"
                  />
                  <span className="text-gray-800 flex-1">{option}</span>
                </label>
              ))}
            </div>

            <details className="bg-gray-50 rounded-lg p-4">
              <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium transition-colors">
                Show Answer & Explanation
              </summary>
              <div className="mt-4 space-y-3">
                <div>
                  <span className="font-semibold text-gray-800">Correct Answer: </span>
                  <span className="text-green-600 font-medium">{question.correctAnswer}</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-800">Explanation: </span>
                  <p className="text-gray-700 mt-2 leading-relaxed">{question.explanation}</p>
                </div>
              </div>
            </details>
          </div>
        ))}
      </div>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Generating study material...</p>
          </div>
        </div>
      );
    }

    if (!selectedMaterial) {
      return (
        <div className="text-center text-gray-500 py-16">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-gray-700 mb-2">Welcome to StudyGenius</h2>
            <p className="text-lg mb-4">Upload or paste your notes above, then select a study material type to get started.</p>
            <p className="text-sm">Use the Study Material Agent (68e525691cb4a3eb612e3d32) for flashcards, MCQs, and mock tests.</p>
          </div>
        </div>
      );
    }

    switch (selectedMaterial) {
      case 'flashcards':
        return flashcards.length > 0 ? renderFlashcardView() : <p className="text-center text-gray-500 py-12">No flashcards generated.</p>;
      case 'mcqs':
        return mcqs.length > 0 ? renderMCQView() : <p className="text-center text-gray-500 py-12">No MCQs generated.</p>;
      case 'mocktest':
        return mockTest.length > 0 ? renderMockTestView() : <p className="text-center text-gray-500 py-12">No mock test questions generated.</p>;
      default:
        return null;
    }
  };

  return (
    <div
      className="flex h-screen"
      style={{ backgroundColor: COLORS.background }}
    >
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h1
            className="text-center text-4xl font-bold mb-8"
            style={{ color: COLORS.primary }}
          >
            StudyGenius
          </h1>

          {/* Notes Input Section */}
          <div
            className="rounded-xl shadow-lg p-6 mb-8"
            style={{ backgroundColor: COLORS.surface }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: COLORS.text }}>
              Upload or Paste Your Notes
            </h2>

            <div className="flex flex-wrap gap-3 mb-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".txt,.pdf,.doc,.docx"
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-md font-medium transition-colors"
                style={{ backgroundColor: COLORS.primary, color: COLORS.surface }}
              >
                📁 Upload File
              </button>

              <button
                onClick={handlePaste}
                className="px-4 py-2 rounded-md font-medium transition-colors"
                style={{ backgroundColor: COLORS.secondary, color: COLORS.text }}
              >
                📋 Paste from Clipboard
              </button>

              <button
                onClick={clearNotes}
                className="px-4 py-2 rounded-md font-medium transition-colors hover:bg-red-600"
                style={{ backgroundColor: COLORS.error, color: COLORS.surface }}
              >
                🗑️ Clear
              </button>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste your notes here or upload a file..."
              className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 resize-none"
              style={{ borderColor: COLORS.primary }}
            />
          </div>

          {/* Material Type Selection */}
          <div
            className="rounded-xl shadow-lg p-6 mb-8"
            style={{ backgroundColor: COLORS.surface }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: COLORS.text }}>
              Select Study Material
            </h2>

            <div className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={() => generateStudyMaterial('flashcards')}
                disabled={loading}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  selectedMaterial === 'flashcards'
                    ? 'text-white shadow-lg'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                } disabled:opacity-50`}
                style={selectedMaterial === 'flashcards' ? { backgroundColor: COLORS.primary } : {}}
              >
                📚 Flashcards ({flashcards.length})
              </button>

              <button
                onClick={() => generateStudyMaterial('mcqs')}
                disabled={loading}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  selectedMaterial === 'mcqs'
                    ? 'text-white shadow-lg'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                } disabled:opacity-50`}
                style={selectedMaterial === 'mcqs' ? { backgroundColor: COLORS.primary } : {}}
              >
                ❓ MCQs ({mcqs.length})
              </button>

              <button
                onClick={() => generateStudyMaterial('mocktest')}
                disabled={loading}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  selectedMaterial === 'mocktest'
                    ? 'text-white shadow-lg'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                } disabled:opacity-50`}
                style={selectedMaterial === 'mocktest' ? { backgroundColor: COLORS.primary } : {}}
              >
                📝 Mock Test ({mockTest.length})
              </button>
            </div>

            {(selectedMaterial && (flashcards.length > 0 || mcqs.length > 0 || mockTest.length > 0)) && (
              <button
                onClick={downloadMaterials}
                className="px-6 py-2 rounded-lg font-medium transition-colors"
                style={{ backgroundColor: COLORS.success, color: COLORS.surface }}
              >
                💾 Download Materials
              </button>
            )}
          </div>

          {/* Generated Content */}
          <div
            className="rounded-xl shadow-lg p-6"
            style={{ backgroundColor: COLORS.surface }}
          >
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Chat Sidebar */}
      <div
        className="w-80 flex flex-col shadow-2xl border-l"
        style={{ backgroundColor: COLORS.surface, borderLeftColor: COLORS.primary }}
      >
        <div className="p-4 border-b" style={{ borderBottomColor: 'rgba(41, 121, 255, 0.2)' }}>
          <h3
            className="text-lg font-semibold"
            style={{ color: COLORS.text }}
          >
            🎓 AI Tutor Agent ({TUTOR_AGENT_ID})
          </h3>
          <p className="text-sm text-gray-600">68e525750cde5ffc91eee6ea</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 ? (
            <div
              className="text-center px-4 py-6 rounded-lg"
              style={{ backgroundColor: COLORS.background }}
            >
              <p className="text-sm" style={{ color: COLORS.text }}>
                Upload your notes and ask questions to get started!
              </p>
            </div>
          ) : (
            chatMessages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] p-3 rounded-lg text-sm ${
                    message.role === 'user'
                      ? 'text-white'
                      : 'text-gray-800'
                  }`}
                  style={{ backgroundColor: message.role === 'user' ? COLORS.primary : COLORS.background }}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  <div className="text-xs opacity-70 mt-1">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
          {isChatLoading && (
            <div className="flex justify-start">
              <div
                className="p-3 rounded-lg text-sm text-gray-800"
                style={{ backgroundColor: COLORS.background }}
              >
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <span>AI Tutor thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef}></div>
        </div>

        <div className="p-4 border-t" style={{ borderTopColor: 'rgba(41, 121, 255, 0.2)' }}>
          <div className="flex space-x-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Ask about your notes..."
              className="flex-1 px-3 py-3 border rounded-lg focus:outline-none focus:ring-2 text-sm"
              style={{
                borderColor: 'rgba(41, 121, 255, 0.2)',
                focusRingColor: COLORS.primary
              }}
              disabled={isChatLoading || !notes.trim()}
            />
            <button
              onClick={sendChatMessage}
              disabled={isChatLoading || !notes.trim() || !chatInput.trim()}
              className="px-4 py-3 rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: COLORS.primary }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;