
export enum Role {
  USER = 'user',
  ASSISTANT = 'assistant'
}

export interface Message {
  role: Role;
  content: string;
  audioData?: string; // Base64 PCM data
}

export interface VoiceConfig {
  enabled: boolean;
  voiceName: 'Charon' | 'Puck' | 'Fenrir' | 'Zephyr';
}
