
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Role, Message } from './types';
import * as geminiService from './services/geminiService';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  // 音声の自動再生をデフォルトでONに設定
  const [isAutoPlay, setIsAutoPlay] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setIsProfileLoaded(true), 1000);
    return () => {
      clearTimeout(timer);
      stopLiveSession();
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
    nextStartTimeRef.current = 0;
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

  const stopLiveSession = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextInRef.current) {
      audioContextInRef.current.close();
      audioContextInRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    stopAllAudio();
    setIsLive(false);
  }, []);

  const startLiveSession = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextInRef.current = new AudioContext({ sampleRate: 16000 });
      if (!audioContextOutRef.current || audioContextOutRef.current.state === 'closed') {
        audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      const sessionPromise = geminiService.connectLive({
        onopen: () => {
          setIsLive(true);
          const source = audioContextInRef.current!.createMediaStreamSource(stream);
          const processor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
            if (!sessionRef.current) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              int16[i] = inputData[i] * 32768;
            }
            const pcmBlob = {
              data: geminiService.encode(new Uint8Array(int16.buffer)),
              mimeType: 'audio/pcm;rate=16000',
            };
            sessionPromise.then(s => {
              if (s) s.sendRealtimeInput({ media: pcmBlob });
            });
          };
          source.connect(processor);
          processor.connect(audioContextInRef.current!.destination);
        },
        onmessage: async (msg: any) => {
          const audioBase64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioBase64 && audioContextOutRef.current) {
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOutRef.current.currentTime);
            const buffer = await geminiService.decodeAudioData(
              geminiService.decode(audioBase64),
              audioContextOutRef.current,
              24000,
              1
            );
            const source = audioContextOutRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContextOutRef.current.destination);
            source.onended = () => activeSourcesRef.current.delete(source);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            activeSourcesRef.current.add(source);
          }

          if (msg.serverContent?.outputTranscription) {
            setStreamingText(prev => prev + msg.serverContent.outputTranscription.text);
          }
          
          if (msg.serverContent?.turnComplete) {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === Role.ASSISTANT && last.content === streamingText) return prev;
              return [...prev, { role: Role.ASSISTANT, content: streamingText }];
            });
            setStreamingText('');
          }

          if (msg.serverContent?.interrupted) {
            stopAllAudio();
          }
        },
        onerror: (e: any) => {
          console.error("Live session error:", e);
          stopLiveSession();
        },
        onclose: () => {
          setIsLive(false);
          stopLiveSession();
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Mic error:", err);
      alert("マイクを許可してくれな、虎おっさんと喋られへんデ！");
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMsg: Message = { role: Role.USER, content: inputValue };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      let fullResponse = '';
      const stream = geminiService.chatStream([...messages, userMsg]);
      for await (const chunk of stream) {
        fullResponse += chunk;
        setStreamingText(fullResponse);
      }

      let audioData = undefined;
      try {
        audioData = await geminiService.generateToraVoice(fullResponse);
      } catch (e) { console.error("TTS Error:", e); }

      const assistantMsg: Message = { 
        role: Role.ASSISTANT, 
        content: fullResponse,
        audioData: audioData 
      };

      setMessages(prev => [...prev, assistantMsg]);
      setStreamingText('');

      if (isAutoPlay && audioData) {
        playBase64Audio(audioData);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isProfileLoaded) {
    return (
      <div className="fixed inset-0 bg-[#f6f0e6] flex flex-col items-center justify-center z-50">
        <div className="text-7xl mb-6 animate-bounce">🐯</div>
        <h1 className="text-2xl font-black text-gray-800">はよ準備しとるから待っとけ！</h1>
      </div>
    );
  }

  return (
    <div className="chat-container w-full h-full flex flex-col bg-white rounded-3xl shadow-2xl border-[8px] border-[#f6c100] overflow-hidden relative mx-auto">
      {/* Header */}
      <div className={`tiger-stripe py-3 px-4 sm:py-4 sm:px-6 flex items-center justify-between text-white transition-all duration-500 ${isLive ? 'animate-pulse ring-4 ring-inset ring-red-500/50' : ''}`}>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-2xl sm:text-3xl filter drop-shadow-md">🐯</span>
          <div>
            <h2 className="text-lg sm:text-xl font-black leading-tight drop-shadow-sm">虎おっさん</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <label className="hidden md:flex items-center gap-2 cursor-pointer bg-black/40 px-3 py-1.5 rounded-full border border-white/20 hover:bg-black/60 transition-colors">
            <input 
              type="checkbox" 
              checked={isAutoPlay} 
              onChange={() => setIsAutoPlay(!isAutoPlay)}
              className="w-3.5 h-3.5 accent-[#f6c100]"
            />
            <span className="text-[10px] font-black tracking-tighter">自動再生</span>
          </label>
          <button 
            onClick={isLive ? stopLiveSession : startLiveSession}
            className={`px-3 py-1.5 sm:px-5 sm:py-2.5 rounded-full text-[10px] sm:text-xs font-black shadow-xl transition-all transform active:scale-95 flex items-center gap-1 sm:gap-2 ${
              isLive ? 'bg-red-600 text-white animate-pulse' : 'bg-black text-[#f6c100] hover:bg-gray-900'
            }`}
          >
            {isLive ? '切断' : '📞 生電話'}
          </button>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 sm:space-y-5 bg-[#fdfaf5] scroll-smooth">
        {messages.length === 0 && !streamingText && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-20 select-none grayscale p-4">
            <div className="text-7xl sm:text-9xl mb-4">⚾️</div>
            <p className="text-lg sm:text-xl font-black italic tracking-tighter">「はよ喋りかけてこんかい！」</p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === Role.USER ? 'items-end' : 'items-start'} message-in`}>
            <div className={`max-w-[90%] sm:max-w-[85%] p-3 sm:p-4 rounded-2xl shadow-md text-sm sm:text-base leading-relaxed ${
              msg.role === Role.USER 
              ? 'bg-[#f6c100] text-black font-bold rounded-br-none border-b-4 border-black/10' 
              : 'bg-white border-2 border-gray-100 text-gray-800 rounded-bl-none relative'
            }`}>
              {msg.content}
              
              {msg.role === Role.ASSISTANT && msg.audioData && (
                <div className="mt-2 flex items-center gap-2 pt-2 border-t border-black/5">
                  <button 
                    onClick={() => playBase64Audio(msg.audioData!)}
                    className="flex items-center gap-1.5 bg-gray-100 hover:bg-[#f6c100] text-black px-3 py-1 rounded-full text-[10px] font-black transition-all active:scale-95"
                  >
                    <span>▶️ 再生</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="flex flex-col items-start message-in">
            <div className="max-w-[90%] sm:max-w-[85%] p-3 sm:p-4 rounded-2xl shadow-md text-sm sm:text-base bg-white border-2 border-[#f6c100]/40 text-gray-800 rounded-bl-none">
              {streamingText}
              <span className="inline-block w-1.5 h-4 bg-[#f6c100] ml-1 animate-pulse align-middle"></span>
            </div>
          </div>
        )}
        
        {isLoading && !streamingText && (
          <div className="flex items-start">
            <div className="bg-white p-3 rounded-2xl border-2 border-gray-100 flex gap-1 shadow-sm">
              <div className="w-2 h-2 bg-[#f6c100] rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-[#f6c100] rounded-full animate-bounce [animation-delay:-0.1s]"></div>
              <div className="w-2 h-2 bg-[#f6c100] rounded-full animate-bounce [animation-delay:-0.2s]"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field Area */}
      <div className="p-3 sm:p-4 bg-white border-t-2 border-[#f6c100]/10">
        <div className="flex gap-2 items-center w-full">
          <input
            type="text"
            className="flex-1 min-w-0 bg-gray-50 border-2 border-gray-100 focus:border-[#f6c100] focus:bg-white rounded-xl px-4 py-3 text-sm sm:text-base outline-none transition-all font-bold text-gray-900 placeholder:text-gray-400 disabled:opacity-40"
            placeholder={isLive ? "声で喋ってや！" : "阪神について語れ..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLive || isLoading}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            onClick={handleSend}
            disabled={isLive || isLoading || !inputValue.trim()}
            className="shrink-0 bg-black text-[#f6c100] font-black rounded-xl px-4 py-3 sm:px-6 sm:py-3 hover:bg-gray-800 active:scale-95 disabled:opacity-10 shadow-lg transition-all text-sm sm:text-base"
          >
            {isLoading ? '...' : '送信'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes grow { 0%, 100% { transform: scaleY(0.4); opacity: 0.5; } 50% { transform: scaleY(1.2); opacity: 1; } }
        .animate-grow { transform-origin: center; animation: grow 0.7s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default App;
