import React, { useState, useRef } from 'react';
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

const API_KEY = 'sk-default-obhGvAo6gG9YT9tu6ChjyXLqnw7TxSGY';
const STUDY_AGENT_ID = '68e525691cb4a3eb612e3d32';
const TUTOR_AGENT_ID = '68e525750cde5ffc91eee6ea';

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
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateRandomString = () => Math.random().toString(36).substring(2, 15);

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

  const handlePaste = () => {
    navigator.clipboard.readText().then(text => {
      setNotes(prev => prev + text);
    });
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
      const response = await fetch('https://agent-prod.studio.lyzr.ai/v3/inference/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          user_id: `${generateRandomString()}@test.com`,
          agent_id: STUDY_AGENT_ID,
          session_id: `${STUDY_AGENT_ID}-${generateRandomString()}`,
          message: `Generate ${type} from these notes: ${notes}`,
        }),
      });

      const data = await response.json();
      const content = data.response || data.message || data.content;

      let parsedData;
      try {
        parsedData = parseLLMJson(content);
      } catch {
        parsedData = eval(`(${content})`);
      }

      if (type === 'flashcards') {
        setFlashcards(Array.isArray(parsedData) ? parsedData : parsedData.flashcards || []);
      } else if (type === 'mcqs') {
        setMcqs(Array.isArray(parsedData) ? parsedData : parsedData.mcqs || []);
      } else if (type === 'mocktest') {
        setMockTest(Array.isArray(parsedData) ? parsedData : parsedData.mockTest || []);
      }
    } catch (error) {
      console.error('Error generating study material:', error);
      alert('Error generating study material. Please try again.');
    } finally {
      setLoading(false);
    }
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
          user_id: `${generateRandomString()}@test.com`,
          agent_id: TUTOR_AGENT_ID,
          session_id: `${TUTOR_AGENT_ID}-${generateRandomString()}`,
          message: `Based on these notes: ${notes}\n\nQuestion: ${chatInput}`,
        }),
      });

      const data = await response.json();
      const content = data.response || data.message || data.content || 'No response received.';

      const assistantMessage: ChatMessage = {
        id: generateRandomString(),
        role: 'assistant',
        content: content,
        timestamp: new Date(),
      };

      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      setChatMessages(prev => [...prev, {
        id: generateRandomString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const downloadMaterials = () => {
    let content = '';
    let filename = '';

    if (selectedMaterial === 'flashcards') {
      filename = 'flashcards.txt';
      flashcards.forEach((card, index) => {
        content += `Flashcard ${index + 1}:\nQ: ${card.question}\nA: ${card.answer}\n\n`;
      });
    } else if (selectedMaterial === 'mcqs') {
      filename = 'mcqs.txt';
      mcqs.forEach((mcq, index) => {
        content += `Question ${index + 1}: ${mcq.question}\n`;
        mcq.options.forEach((option, optIndex) => {
          content += `${String.fromCharCode(65 + optIndex)}. ${option}\n`;
        });
        content += `Answer: ${mcq.correctAnswer}\n\n`;
      });
    } else if (selectedMaterial === 'mocktest') {
      filename = 'mock_test.txt';
      mockTest.forEach((question, index) => {
        content += `Question ${index + 1}: ${question.question}\n`;
        question.options.forEach((option, optIndex) => {
          content += `${String.fromCharCode(65 + optIndex)}. ${option}\n`;
        });
        content += `Answer: ${question.correctAnswer}\n`;
        content += `Explanation: ${question.explanation}\n\n`;
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

  const resetResults = () => {
    setShowResults(false);
    setMcqAnswers({});
    setCurrentPage(1);
  };

  const FlashcardView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-600">
          Card {activeFlashcard + 1} of {flashcards.length}
        </span>
        <div className="space-x-2">
          <button
            onClick={() => setActiveFlashcard(Math.max(0, activeFlashcard - 1))}
            className="px-3 py-1 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50"
            disabled={activeFlashcard === 0}
          >
            Previous
          </button>
          <button
            onClick={() => setActiveFlashcard(Math.min(flashcards.length - 1, activeFlashcard + 1))}
            className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            disabled={activeFlashcard === flashcards.length - 1}
          >
            Next
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Question</h3>
          <p className="text-lg text-gray-700">{flashcards[activeFlashcard]?.question}</p>
        </div>

        <button
          className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 mb-6"
          onClick={(e) => {
            const answer = e.currentTarget.nextElementSibling as HTMLElement;
            if (answer.style.display === 'none') {
              answer.style.display = 'block';
            } else {
              answer.style.display = 'none';
            }
          }}
        >
          Show Answer
        </button>

        <div style={{ display: 'none' }}>
          <h3 className="text-xl font-bold text-gray-800 mb-4">Answer</h3>
          <p className="text-lg text-gray-700">{flashcards[activeFlashcard]?.answer}</p>
        </div>
      </div>
    </div>
  );

  const MCQView = () => (
    <div className="space-y-4">
      {mcqs.map((mcq, index) => (
        <div key={index} className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4">{index + 1}. {mcq.question}</h3>
          <div className="space-y-2 mb-4">
            {mcq.options.map((option, optIndex) => (
              <label key={optIndex} className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name={`question-${index}`}
                  value={option}
                  checked={mcqAnswers[index] === option}
                  onChange={() => setMcqAnswers(prev => ({ ...prev, [index]: option }))}
                  className="text-blue-500"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowResults(true)}
          className="px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
          disabled={Object.keys(mcqAnswers).length < mcqs.length}
        >
          Submit Answers
        </button>

        <span className="text-sm text-gray-600">
          Answered: {Object.keys(mcqAnswers).length} / {mcqs.length}
        </span>
      </div>

      {showResults && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4">Results</h3>
          <div className="space-y-2">
            {mcqs.map((mcq, index) => (
              <div key={index} className="flex items-center space-x-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-sm ${
                  mcqAnswers[index] === mcq.correctAnswer ? 'bg-green-500' : 'bg-red-500'
                }`}>
                  {mcqAnswers[index] === mcq.correctAnswer ? '✓' : '✗'}
                </span>
                <span className={`text-sm ${
                  mcqAnswers[index] === mcq.correctAnswer ? 'text-green-600' : 'text-red-600'
                }`}>
                  Question {index + 1}: {mcqAnswers[index] === mcq.correctAnswer ? 'Correct' : 'Incorrect'}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={resetResults}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Retake Quiz
          </button>
        </div>
      )}
    </div>
  );

  const MockTestView = () => {
    const startIndex = (currentPage - 1) * 5;
    const currentQuestions = mockTest.slice(startIndex, startIndex + 5);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-gray-600">
            Page {currentPage} of {Math.ceil(mockTest.length / 5)}
          </span>
          <div className="space-x-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              className="px-3 py-1 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50"
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(Math.ceil(mockTest.length / 5), currentPage + 1))}
              className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
              disabled={currentPage >= Math.ceil(mockTest.length / 5)}
            >
              Next
            </button>
          </div>
        </div>

        {currentQuestions.map((question, index) => (
          <div key={startIndex + index} className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              {startIndex + index + 1}. {question.question}
            </h3>
            <div className="space-y-2 mb-4">
              {question.options.map((option, optIndex) => (
                <label key={optIndex} className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name={`mock-question-${startIndex + index}`}
                    value={option}
                    className="text-blue-500"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                Show Answer & Explanation
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded-md">
                <p><strong>Answer:</strong> {question.correctAnswer}</p>
                <p><strong>Explanation:</strong> {question.explanation}</p>
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Generating study material...</p>
          </div>
        </div>
      );
    }

    if (!selectedMaterial) {
      return (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg mb-2">Welcome to StudyGenius!</p>
          <p>Upload or paste your notes above, then select a study material type to get started.</p>
        </div>
      );
    }

    switch (selectedMaterial) {
      case 'flashcards':
        return flashcards.length > 0 ? <FlashcardView /> : <p>No flashcards generated.</p>;
      case 'mcqs':
        return mcqs.length > 0 ? <MCQView /> : <p>No MCQs generated.</p>;
      case 'mocktest':
        return mockTest.length > 0 ? <MockTestView /> : <p>No mock test questions generated.</p>;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-[#F5F7FB]">
      {/* Main Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold text-[#2979FF] mb-8 text-center">StudyGenius</h1>

          {/* Notes Input Section */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Upload or Paste Your Notes</h2>
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
                className="px-4 py-2 bg-[#2979FF] text-white rounded-md hover:bg-blue-600"
              >
                📁 Upload File
              </button>
              <button
                onClick={handlePaste}
                className="px-4 py-2 bg-[#FFD600] text-gray-800 rounded-md hover:bg-yellow-500"
              >
                📋 Paste from Clipboard
              </button>
              <button
                onClick={clearNotes}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
              >
                🗑️ Clear
              </button>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste your notes here or upload a file..."
              className="w-full h-32 p-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2979FF]"
            />
          </div>

          {/* Material Type Selection */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Select Study Material Type</h2>
            <div className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={() => generateStudyMaterial('flashcards')}
                disabled={loading}
                className={`px-6 py-2 rounded-md font-medium ${
                  selectedMaterial === 'flashcards'
                    ? 'bg-[#2979FF] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                📚 Flashcards ({flashcards.length})
              </button>
              <button
                onClick={() => generateStudyMaterial('mcqs')}
                disabled={loading}
                className={`px-6 py-2 rounded-md font-medium ${
                  selectedMaterial === 'mcqs'
                    ? 'bg-[#2979FF] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                ❓ MCQs ({mcqs.length})
              </button>
              <button
                onClick={() => generateStudyMaterial('mocktest')}
                disabled={loading}
                className={`px-6 py-2 rounded-md font-medium ${
                  selectedMaterial === 'mocktest'
                    ? 'bg-[#2979FF] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                📝 Mock Test ({mockTest.length})
              </button>
            </div>

            {(flashcards.length > 0 || mcqs.length > 0 || mockTest.length > 0) && (
              <button
                onClick={downloadMaterials}
                className="px-6 py-2 bg-[#43A047] text-white rounded-md hover:bg-green-600"
              >
                💾 Download Materials
              </button>
            )}
          </div>

          {/* Content Display */}
          <div className="bg-white rounded-xl shadow-md p-6">
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Chat Sidebar */}
      <div className="w-80 bg-white shadow-lg flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">🎓 AI Tutor</h3>
          <p className="text-sm text-gray-600">Ask questions about your notes</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <p className="text-sm">Upload your notes and ask questions to get started!</p>
            </div>
          ) : (
            chatMessages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-lg text-sm ${
                  message.role === 'user'
                    ? 'bg-[#2979FF] text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}>
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
              <div className="bg-gray-100 text-gray-800 p-3 rounded-lg text-sm">
                <div className="flex items-center space-x-2">
                  <div className="animate-pulse">...</div>
                  <span>AI Tutor is thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200">
          <div className="flex space-x-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Ask a question..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2979FF] text-sm"
              disabled={isChatLoading || !notes.trim()}
            />
            <button
              onClick={sendChatMessage}
              className="px-4 py-2 bg-[#2979FF] text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
              disabled={isChatLoading || !notes.trim() || !chatInput.trim()}
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