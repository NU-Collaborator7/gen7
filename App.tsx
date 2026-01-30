
import React, { useState, useRef, useEffect } from 'react';
import { Role, Message } from './types';
import * as geminiService from './services/geminiService';

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isAutoPlay, setIsAutoPlay] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setIsProfileLoaded(true), 1000);
    
    // 音声認識の初期化
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ja-JP';

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            setInputValue(prev => prev + event.results[i][0].transcript);
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      clearTimeout(timer);
      stopAllAudio();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
  };

  const playBase64Audio = async (base64: string) => {
    if (!audioContextOutRef.current || audioContextOutRef.current.state === 'closed') {
      audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
    }
    stopAllAudio();
    const buffer = await geminiService.decodeAudioData(
      geminiService.decode(base64),
      audioContextOutRef.current,
      24000,
      1
    );
    const source = audioContextOutRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextOutRef.current.destination);
    source.onended = () => activeSourcesRef.current.delete(source);
    source.start();
    activeSourcesRef.current.add(source);
  };

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      // 音声入力を停止した後に少し待って送信
      setTimeout(() => handleSend(), 500);
    } else {
      setInputValue('');
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleSend = async (manualInput?: string) => {
    const text = manualInput || inputValue;
    if (!text.trim() || isLoading) return;

    const userMsg = { role: Role.USER, content: text };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const lowerText = text.toLowerCase();
      // 画像生成の判定
      if (lowerText.includes('画像') || lowerText.includes('描いて') || lowerText.includes('画像生成')) {
        const imageUrl = await geminiService.generateImage(text);
        if (imageUrl) {
          setMessages(prev => [...prev, { 
            role: Role.ASSISTANT, 
            content: "よっしゃ、虎おっさん特製の画像作ったデ！どや、ええ感じやろ？",
            imageUrl 
          }]);
          setIsLoading(false);
          return;
        }
      }

      // 通常のチャット（3行程度の回答）
      let fullResponse = '';
      const stream = geminiService.chatStream([...messages, userMsg]);
      for await (const chunk of stream) {
        fullResponse += chunk;
        setStreamingText(fullResponse);
      }

      let audioData = undefined;
      try {
        audioData = await geminiService.generateToraVoice(fullResponse);
      } catch (e) { console.error(e); }

      setMessages(prev => [...prev, { 
        role: Role.ASSISTANT, 
        content: fullResponse,
        audioData: audioData 
      }]);
      setStreamingText('');

      if (isAutoPlay && audioData) {
        playBase64Audio(audioData);
      }
    } catch (error: any) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isProfileLoaded) {
    return (
      <div className="fixed inset-0 bg-[#f6f0e6] flex flex-col items-center justify-center z-50">
        <div className="text-7xl mb-6 animate-bounce">🐯</div>
        <h1 className="text-2xl font-black text-gray-800 italic">準備中や、待っとけ！</h1>
      </div>
    );
  }

  return (
    <div className="chat-container w-full h-full flex flex-col bg-white rounded-3xl shadow-2xl border-[8px] border-[#f6c100] overflow-hidden relative mx-auto">
      {/* Header */}
      <div className="tiger-stripe py-4 px-6 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <span className="text-3xl filter drop-shadow-md">🐯</span>
          <h2 className="text-xl font-black leading-tight drop-shadow-sm">虎おっさん V3</h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer bg-black/40 px-3 py-1.5 rounded-full border border-white/20 hover:bg-black/60 transition-colors">
            <input 
              type="checkbox" 
              checked={isAutoPlay} 
              onChange={() => setIsAutoPlay(!isAutoPlay)}
              className="w-4 h-4 accent-[#f6c100]"
            />
            <span className="text-[10px] font-black uppercase tracking-widest">Auto Voice</span>
          </label>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#fdfaf5] scroll-smooth">
        {messages.length === 0 && !streamingText && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30 select-none grayscale p-4">
            <div className="text-9xl mb-4">⚾️</div>
            <p className="text-2xl font-black italic tracking-tighter">「なんでも喋りかけてや！阪神の話やったらナンボでもあるデ！」</p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === Role.USER ? 'items-end' : 'items-start'} message-in`}>
            <div className={`max-w-[85%] p-4 rounded-2xl shadow-md text-base leading-relaxed ${
              msg.role === Role.USER 
              ? 'bg-[#f6c100] text-black font-bold rounded-br-none border-b-4 border-black/10' 
              : 'bg-white border-2 border-gray-100 text-gray-800 rounded-bl-none'
            }`}>
              {msg.content}
              
              {msg.imageUrl && (
                <div className="mt-3 rounded-lg overflow-hidden border-2 border-[#f6c100] shadow-lg">
                  <img src={msg.imageUrl} alt="Generated" className="w-full h-auto" />
                </div>
              )}

              {msg.role === Role.ASSISTANT && msg.audioData && !msg.imageUrl && (
                <div className="mt-3 flex items-center gap-2 pt-2 border-t border-black/5">
                  <button 
                    onClick={() => playBase64Audio(msg.audioData!)}
                    className="flex items-center gap-2 bg-gray-100 hover:bg-[#f6c100] text-black px-4 py-1.5 rounded-full text-xs font-black transition-all active:scale-95"
                  >
                    <span>▶️ 再生するで</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="flex flex-col items-start message-in">
            <div className="max-w-[85%] p-4 rounded-2xl shadow-md text-base bg-white border-2 border-[#f6c100]/40 text-gray-800 rounded-bl-none whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-2 h-5 bg-[#f6c100] ml-1 animate-pulse align-middle"></span>
            </div>
          </div>
        )}
        
        {isLoading && !streamingText && (
          <div className="flex items-start">
            <div className="bg-white p-3 rounded-2xl border-2 border-gray-100 flex gap-1.5 shadow-sm">
              <div className="w-2.5 h-2.5 bg-[#f6c100] rounded-full animate-bounce"></div>
              <div className="w-2.5 h-2.5 bg-[#f6c100] rounded-full animate-bounce [animation-delay:-0.1s]"></div>
              <div className="w-2.5 h-2.5 bg-[#f6c100] rounded-full animate-bounce [animation-delay:-0.2s]"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t-4 border-[#f6c100]/20">
        <div className="flex gap-2 items-center w-full">
          <button
            onClick={toggleRecording}
            className={`shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all shadow-lg border-b-4 active:scale-95 ${
              isRecording 
              ? 'bg-red-500 text-white animate-pulse border-red-700' 
              : 'bg-white text-gray-400 border-gray-200 hover:text-black'
            }`}
            title={isRecording ? "止めて送信" : "声で喋る"}
          >
            <span className="text-xl">{isRecording ? '⏹️' : '🎤'}</span>
          </button>

          <input
            type="text"
            className="flex-1 min-w-0 bg-gray-50 border-2 border-gray-100 focus:border-[#f6c100] focus:bg-white rounded-2xl px-5 py-3 text-base outline-none transition-all font-bold text-gray-900 placeholder:text-gray-300 disabled:opacity-40"
            placeholder={isRecording ? "喋っとるで... (もう一度押して送信)" : "なんでも聞いてや！"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />

          <button
            onClick={() => handleSend()}
            disabled={isLoading || !inputValue.trim()}
            className="shrink-0 bg-black text-[#f6c100] font-black rounded-2xl px-6 h-12 hover:bg-gray-800 active:scale-95 disabled:opacity-20 shadow-lg transition-all"
          >
            {isLoading ? '...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
