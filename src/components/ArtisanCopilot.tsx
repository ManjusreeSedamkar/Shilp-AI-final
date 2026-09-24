import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, MicOff, Volume2, VolumeX, Sparkles, Bot, User, ArrowRight, CheckCircle2, Settings, Loader2, Play, Square, Copy, FileText, Check, X } from 'lucide-react';
import { CopilotMessage, ProductListing, Language } from '../types';
import { ArtisanCopilotService } from '../services/copilotService';
import { VoiceCatalogerEngine } from '../services/voiceCataloger';
import { askGemini, hasGeminiApiKey } from '../services/geminiService';
import { getSpeechLangCode, translate } from '../services/translations';
import { getProductTitle } from '../services/displayTranslation';
import { CRAFT_PRESETS } from '../data/craftPresets';
import { ApiSettingsModal } from './ApiSettingsModal';

interface ArtisanCopilotProps {
  language?: Language;
  onPublishListing?: (listing: ProductListing) => void;
}

export const ArtisanCopilot: React.FC<ArtisanCopilotProps> = ({
  language = 'en',
  onPublishListing
}) => {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    ArtisanCopilotService.getInitialGreeting(language)
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState<string | null>(null);
  const [spokenTranscripts, setSpokenTranscripts] = useState<{ [messageId: string]: string }>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const t = (key: string) => translate(language, key);
  // isHindi removed — use language directly
  const hasGemini = hasGeminiApiKey();

  // Sync speech recognition language and initial greeting on language change
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = getSpeechLangCode(language);
    }
    setMessages((prev) => {
      if (prev.length <= 1) {
        return [ArtisanCopilotService.getInitialGreeting(language)];
      }
      return prev;
    });
  }, [language]);
  // Scroll to bottom on message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Setup Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = getSpeechLangCode(language);

      recognition.onresult = (event: any) => {
        const transcriptText = event.results[0][0].transcript;
        setIsRecording(false);
        if (transcriptText) {
          handleSendMessage(transcriptText);
        }
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, [language]);

  // Stop any active speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text) return;

    // Cancel current speech if any
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeakingMessageId(null);
    }

    const userMessage: CopilotMessage = {
      id: `user-${Date.now()}`,
      sender: 'artisan',
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputValue('');
    setIsLoading(true);

    try {
      let replyText = '';
      let replyAudioText = '';
      let actionCard = undefined;

      // 1. Try Gemini API first if configured
      if (hasGeminiApiKey()) {
        try {
          const geminiReply = await askGemini(
            text,
            language,
            `You are SHILP-AI Copilot, an empathetic, expert virtual business manager supporting Indian marginalized artisans, weavers, and craftspersons. ` +
            `Explain app procedures, help with smart catalogs, advise on wholesale negotiation, discuss fair pricing (at least ₹750/day wage), and explain government schemes (MoSJE, PM Vishwakarma, Shilp Samagam). ` +
            `Keep answers concise, actionable, and structured with bullet points. Always reply in the requested language.`
          );
          replyText = geminiReply;
          replyAudioText = geminiReply.slice(0, 200); // First 200 chars for voice
        } catch (apiErr) {
          console.warn('Gemini API call failed, falling back to local copilot:', apiErr);
        }
      }

      // 2. Fallback to local intelligent rule/intent engine if Gemini was not used or failed
      if (!replyText) {
        const localResult = ArtisanCopilotService.processArtisanInput(
          text,
          newHistory,
          language
        );
        replyText = localResult.reply.text;
        replyAudioText = localResult.reply.audioText || localResult.reply.text;
        actionCard = localResult.reply.actionCard;
      }

      const copilotReply: CopilotMessage = {
        id: `copilot-${Date.now()}`,
        sender: 'copilot',
        text: replyText,
        audioText: replyAudioText,
        actionCard,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, copilotReply]);

      // Auto-read response if speech synthesis is enabled
      handlePlayVoice(copilotReply);
    } catch (err) {
      console.error('Copilot processing error:', err);
      const fallbackMsg: CopilotMessage = {
        id: `copilot-${Date.now()}`,
        sender: 'copilot',
        text: translate(language, 'auto.i_encountered_an_iss.6'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        setIsRecording(true);
        recognitionRef.current?.start();
      } catch (err) {
        console.warn('Speech recognition not available:', err);
        // Fallback simulated input for demo
        setTimeout(() => {
          setIsRecording(false);
          const sample = language === 'hi' ? CRAFT_PRESETS[0].sampleVoiceHindi : CRAFT_PRESETS[0].sampleVoiceEnglish;
          handleSendMessage(sample);
        }, 1500);
      }
    }
  };

  // Toggle Play / Stop Voice for an AI response
  const handleToggleVoice = (msg: CopilotMessage) => {
    if (isSpeakingMessageId === msg.id) {
      // User requested STOP
      handleStopVoice();
    } else {
      // User requested PLAY / START
      handlePlayVoice(msg);
    }
  };

  const handleStopVoice = () => {
    VoiceCatalogerEngine.stopSpeaking();
    setIsSpeakingMessageId(null);
  };

  const handlePlayVoice = async (msg: CopilotMessage) => {
    handleStopVoice(); // Stop any other message currently playing
    setIsSpeakingMessageId(msg.id);

    const textToSpeak = msg.audioText || msg.text;
    const langCode = getSpeechLangCode(language);

    // Save into spoken transcripts so it remains displayed and readable when stopped!
    setSpokenTranscripts((prev) => ({
      ...prev,
      [msg.id]: textToSpeak
    }));

    try {
      await VoiceCatalogerEngine.speak(textToSpeak, langCode as any);
    } catch (err) {
      console.warn('Speech playback error:', err);
    } finally {
      setIsSpeakingMessageId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 flex flex-col h-[calc(100dvh-180px)] min-h-[380px] max-h-[720px] w-full max-w-full overflow-hidden">
      {/* ShilpSaathi Header */}
      <div className="bg-stone-900 p-4 text-white flex items-center justify-between border-b border-stone-800">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-amber-400 font-bold shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-stone-900"></span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-sm text-white">
                ShilpSaathi
              </h3>
              <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-medium text-amber-200">
                {hasGemini ? 'Gemini 2.0 AI' : 'ShilpSaathi AI'}
              </span>
            </div>
            <p className="text-[11px] text-stone-300">
              {hasGemini ? 'Powered by Google Gemini Live Intelligence' : 'Artisan Business & Smart Catalog Assistant'}
            </p>
          </div>
        </div>

        {/* Status Pill & Settings Button */}
        <div className="flex items-center space-x-2">
          <span className="text-[11px] text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/30 hidden sm:flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            Online
          </span>
          <button
            onClick={() => setShowSettings(true)}
            title="Configure Gemini API Key"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-stone-50/50">
        {messages.map((msg) => {
          const isUser = msg.sender === 'artisan';
          const isCurrentlyPlaying = isSpeakingMessageId === msg.id;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] sm:max-w-[80%] rounded-2xl p-3.5 shadow-2xs text-xs ${
                  isUser
                    ? 'bg-stone-900 text-white rounded-br-xs'
                    : 'bg-white text-stone-800 border border-stone-200/90 rounded-bl-xs'
                }`}
              >
                {/* Header: Sender & Voice Play/Stop Controls */}
                <div className="flex items-center justify-between mb-1.5 text-[10px] opacity-80 border-b border-stone-100/50 pb-1">
                  <span className="font-bold flex items-center gap-1">
                    {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-stone-700" />}
                    {isUser
                      ? translate(language, 'auto.you_artisan.7')
                      : (language === 'hi' ? 'शिल्प साथी (SHILP Saathi)' : 'SHILP Saathi AI')}
                  </span>

                  {/* Play / Stop Voice Button for Every AI Response */}
                  {!isUser && (
                    <button
                      onClick={() => handleToggleVoice(msg)}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold transition-all text-[10px] ${
                        isCurrentlyPlaying
                          ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300 ring-2 ring-red-200 animate-pulse'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200'
                      }`}
                      title={isCurrentlyPlaying ? 'Stop Voice' : 'Listen with AI Voice'}
                    >
                      {isCurrentlyPlaying ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-red-600 text-red-600" />
                          <span>{translate(language, 'auto.stop.8')}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping"></span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-2.5 h-2.5 text-stone-600" />
                          <span>{translate(language, 'auto.listen.9')}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Message Text Body */}
                <p className="leading-relaxed whitespace-pre-line text-xs font-normal">
                  {msg.text}
                </p>

                {/* AI Audio Transcription Box when speaking or when stopped */}
                {!isUser && spokenTranscripts[msg.id] && (
                  <div className="mt-2 p-2.5 bg-amber-50/90 rounded-xl border border-amber-200 text-stone-800 space-y-1.5 animate-in fade-in duration-200 shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] font-bold border-b border-amber-200/80 pb-1">
                      <span className="flex items-center gap-1 text-amber-900">
                        <FileText className="w-3 h-3 text-amber-700" />
                        {translate(language, 'auto.ai_spoken_audio_tran.10')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-semibold flex items-center gap-1 ${
                          isCurrentlyPlaying
                            ? 'bg-red-100 text-red-700 animate-pulse border border-red-200'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${isCurrentlyPlaying ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                          {isCurrentlyPlaying ? (translate(language, 'auto.speaking.11')) : (translate(language, 'auto.stopped_read.12'))}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(spokenTranscripts[msg.id]);
                            setCopiedMessageId(msg.id);
                            setTimeout(() => setCopiedMessageId(null), 2000);
                          }}
                          className="text-stone-500 hover:text-stone-800 p-0.5 rounded hover:bg-amber-100 transition-colors"
                          title="Copy transcript"
                        >
                          {copiedMessageId === msg.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => {
                            if (isCurrentlyPlaying) {
                              handleStopVoice();
                            }
                            setSpokenTranscripts((prev) => {
                              const copy = { ...prev };
                              delete copy[msg.id];
                              return copy;
                            });
                          }}
                          className="text-stone-400 hover:text-stone-700 p-0.5 rounded hover:bg-amber-100 transition-colors"
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] font-mono text-stone-700 leading-relaxed bg-white/80 p-2 rounded-lg border border-amber-200/60 select-text">
                      "{spokenTranscripts[msg.id]}"
                    </p>
                    {copiedMessageId === msg.id && (
                      <div className="text-[9px] text-emerald-700 font-semibold text-right">
                        {translate(language, 'auto.transcript_copied_to.13')}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Card: Listing Ready Embedded Card */}
                {msg.actionCard?.type === 'listing_ready' && msg.actionCard.data && (
                  <div className="mt-3 p-3 bg-stone-50 rounded-xl border border-stone-200 text-stone-900 space-y-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={msg.actionCard.data.enhancedImage || msg.actionCard.data.originalImage}
                        alt="Product"
                        className="w-14 h-14 rounded-lg object-cover border border-stone-200 shadow-sm"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">
                          {translate(language, 'auto.listing_ready.14')}
                        </span>
                        <h4 className="font-bold text-xs truncate">
                          {getProductTitle(msg.actionCard.data, language)}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] font-mono mt-0.5">
                          <span className="font-bold text-stone-900">
                            ₹{msg.actionCard.data.pricing?.suggestedRetailPrice?.toLocaleString('en-IN')}
                          </span>
                          <span className="text-stone-500">
                            ({msg.actionCard.data.productionDays} {translate(language, 'auto.days.15')})
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-stone-200 flex justify-between items-center">
                      <span className="text-[10px] text-stone-500 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        GI & MoSJE Ready
                      </span>
                      <button
                        onClick={() => onPublishListing?.(msg.actionCard!.data)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors"
                      >
                        <span>{translate(language, 'auto.publish_listing.16')}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                <span className="block text-[9px] mt-1 text-right opacity-60">
                  {msg.timestamp}
                </span>
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex items-start space-x-2">
            <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-none p-3 shadow-xs flex items-center space-x-2 text-stone-600 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-saffron-600" />
              <span>{hasGemini ? 'Gemini 2.0 Thinking...' : 'ShilpSaathi Thinking...'}</span>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Quick Prompt Suggestions */}
      <div className="px-3 py-2 bg-stone-100/70 border-t border-stone-200 flex items-center space-x-2 overflow-x-auto no-scrollbar text-xs">
        <span className="text-[10px] font-bold text-stone-500 whitespace-nowrap">
          {translate(language, 'auto.quick_help.17')}
        </span>
        <button
          onClick={() => handleSendMessage(translate(language, 'auto.how_does_this_app_wo.18'))}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white hover:bg-stone-50 text-stone-700 hover:text-saffron-800 text-[11px] font-medium border border-stone-200 shadow-2xs transition-colors flex items-center gap-1"
        >
          <span>📱</span>
          <span>{translate(language, 'auto.how_to_use_app.19')}</span>
        </button>
        <button
          onClick={() => handleSendMessage(translate(language, 'auto.buyer_offering_4_000.20'))}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 text-[11px] font-medium border border-stone-200 shadow-2xs transition-colors flex items-center gap-1"
        >
          <span>💡</span>
          <span>{translate(language, 'auto.wholesale_negotiatio.21')}</span>
        </button>
        <button
          onClick={() => handleSendMessage(translate(language, 'auto.how_do_i_get_a_stall.22'))}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white hover:bg-amber-50 text-stone-700 hover:text-amber-800 text-[11px] font-medium border border-stone-200 shadow-2xs transition-colors flex items-center gap-1"
        >
          <span>🏛️</span>
          <span>{translate(language, 'auto.shilp_samagam_stalls.23')}</span>
        </button>
        <button
          onClick={() => handleSendMessage(translate(language, 'auto.do_i_need_gst_regist.24'))}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white hover:bg-blue-50 text-stone-700 hover:text-blue-800 text-[11px] font-medium border border-stone-200 shadow-2xs transition-colors flex items-center gap-1"
        >
          <span>💳</span>
          <span>{translate(language, 'auto.gst_rules.25')}</span>
        </button>
      </div>

      {/* Input Bar */}
      <div className="p-3 bg-white border-t border-stone-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          {/* Voice Input Button */}
          <button
            type="button"
            onClick={toggleVoiceRecording}
            className={`p-2.5 rounded-xl transition-all ${
              isRecording
                ? 'bg-red-600 text-white animate-pulse ring-4 ring-red-200'
                : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
            }`}
            title="Speak with microphone"
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Text Input Field */}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isRecording
                ? (translate(language, 'auto.listening_speak_now.26'))
                : (translate(language, 'auto.ask_copilot_anything.27'))
            }
            className="flex-1 px-4 py-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-400 focus:bg-white transition-all"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="p-2.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-xl shadow-xs transition-all flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* API Settings Modal */}
      <ApiSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
};
