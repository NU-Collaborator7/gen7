
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, Role } from "../types";
import { TORA_OSSAN_PROFILE } from "../constants";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

/**
 * 現在の日時情報を取得してシステムプロンプトを構築する
 */
const getDynamicSystemInstruction = () => {
  const now = new Date();
  const jstDate = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return `
現在の日本時間: ${jstDate}
${TORA_OSSAN_PROFILE}
上記の現在日時を考慮して会話してください。挨拶や、プロ野球のシーズン（開幕前、交流戦、終盤、オフ等）に合わせた話題を振ってください。
`;
};

// 1. 低遅延テキストストリーミング (gemini-3-flash)
export async function* chatStream(messages: Message[]) {
  const response = await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: messages.map(m => ({
      role: m.role === Role.USER ? 'user' : 'model',
      parts: [{ text: m.content }]
    })),
    config: {
      systemInstruction: getDynamicSystemInstruction(),
      temperature: 0.8,
    }
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

// 2. 爆速TTS (gemini-2.5-flash-tts)
export async function generateToraVoice(text: string) {
  // 記号や絵文字をフィルタリング
  let cleanText = text
    .replace(/[*#]/g, '')
    .replace(/[🐯⚾️🔥]/g, '');

  // 岩崎は「イワザキ」と読ませる
  cleanText = cleanText.replace(/岩崎/g, 'イワザキ');

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `尼崎弁の虎ファンとして感情豊かに読み上げろ: ${cleanText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}

// 3. ライブAPI (gemini-2.5-flash-native-audio)
export const connectLive = (callbacks: any) => {
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
      },
      systemInstruction: getDynamicSystemInstruction(),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
};

// Base64 & Audio Utils
export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
