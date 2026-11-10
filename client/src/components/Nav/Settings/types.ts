import { createElement } from 'react';
import { MessageSquare, Info, Server } from 'lucide-react';
import { SettingsTabValues } from 'librechat-data-provider';
import { GearIcon, DataIcon, UserIcon, SpeechIcon } from '@librechat/client';
import type { ComponentType, ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';

export type SettingsTab =
  | SettingsTabValues.GENERAL
  | SettingsTabValues.CHAT
  | SettingsTabValues.SPEECH
  | SettingsTabValues.DATA
  | SettingsTabValues.PROVIDERS
  | SettingsTabValues.ACCOUNT
  | SettingsTabValues.ABOUT;

export type SectionId =
  | 'appearance'
  | 'layout'
  | 'notifications'
  | 'accessibility'
  | 'admin'
  | 'sending'
  | 'commands'
  | 'messages'
  | 'conversations'
  | 'prompts'
  | 'stt'
  | 'tts'
  | 'memory'
  | 'codeExecution'
  | 'data'
  | 'providers'
  | 'apiKeys'
  | 'danger'
  | 'profile'
  | 'security'
  | 'connections'
  | 'billing'
  | 'about';

export interface SettingsContextValue {
  balanceEnabled: boolean;
  hasAnyPersonalizationFeature: boolean;
  hasMemoryOptOut: boolean;
  hasStatefulCodeSessions: boolean;
  hasRemoteAgents: boolean;
  hasUserProvidedEndpoints: boolean;
  hasMultiConvo: boolean;
  hasPrompts: boolean;
  isLocalProvider: boolean;
  emailEnabled: boolean;
  allowEmailChange: boolean;
  passkeyLoginEnabled: boolean;
  hasPullRequestConnect: boolean;
  isTwoFactorPolicyProvider: boolean;
  twoFactorEnabled: boolean;
  allowAccountDeletion: boolean;
  aboutEnabled: boolean;
  mascotAllowed: boolean;
  engineTTS: string;
  adminPanelURL: string;
  replyTabBadgeAllowed: boolean;
  replyNotificationsAllowed: boolean;
  replyNotificationSoundAllowed: boolean;
  analyticsConfigured: boolean;
}

export interface SettingEntry {
  id: string;
  tab: SettingsTab;
  section: SectionId;
  labelKey: TranslationKeys;
  keywords?: string[];
  Component: ComponentType;
  show?: (ctx: SettingsContextValue) => boolean;
}

export interface SectionMeta {
  id: SectionId;
  labelKey: TranslationKeys;
  icon?: ReactNode;
  danger?: boolean;
}

export interface TabMeta {
  id: SettingsTab;
  labelKey: TranslationKeys;
  icon: ReactNode;
  sections: SectionMeta[];
  show?: (ctx: SettingsContextValue) => boolean;
}

export const TABS: TabMeta[] = [
  {
    id: SettingsTabValues.GENERAL,
    labelKey: 'com_nav_setting_general',
    icon: createElement(GearIcon),
    sections: [
      { id: 'appearance', labelKey: 'com_ui_settings_section_appearance' },
      { id: 'layout', labelKey: 'com_ui_settings_section_layout' },
      { id: 'notifications', labelKey: 'com_ui_settings_section_notifications' },
      { id: 'accessibility', labelKey: 'com_ui_settings_section_accessibility' },
      { id: 'admin', labelKey: 'com_ui_settings_section_admin' },
    ],
  },
  {
    id: SettingsTabValues.CHAT,
    labelKey: 'com_nav_setting_chat',
    icon: createElement(MessageSquare, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [
      { id: 'sending', labelKey: 'com_ui_settings_section_sending' },
      { id: 'commands', labelKey: 'com_ui_settings_section_commands' },
      { id: 'messages', labelKey: 'com_ui_settings_section_messages' },
      { id: 'conversations', labelKey: 'com_ui_settings_section_conversations' },
      { id: 'prompts', labelKey: 'com_ui_settings_section_prompts' },
    ],
  },
  {
    id: SettingsTabValues.SPEECH,
    labelKey: 'com_nav_setting_speech',
    icon: createElement(SpeechIcon, { className: 'icon-sm' }),
    sections: [
      { id: 'stt', labelKey: 'com_ui_settings_section_stt' },
      { id: 'tts', labelKey: 'com_ui_settings_section_tts' },
    ],
  },
  {
    id: SettingsTabValues.DATA,
    labelKey: 'com_ui_settings_tab_data',
    icon: createElement(DataIcon),
    sections: [
      { id: 'memory', labelKey: 'com_ui_settings_section_memory' },
      { id: 'codeExecution', labelKey: 'com_ui_settings_section_code_execution' },
      { id: 'data', labelKey: 'com_ui_settings_section_data' },
      { id: 'apiKeys', labelKey: 'com_ui_settings_section_api_keys' },
      { id: 'danger', labelKey: 'com_ui_settings_section_danger_zone', danger: true },
    ],
  },
  {
    id: SettingsTabValues.PROVIDERS,
    labelKey: 'com_ui_settings_tab_providers',
    icon: createElement(Server, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [{ id: 'providers', labelKey: 'com_ui_settings_section_providers' }],
  },
  {
    id: SettingsTabValues.ACCOUNT,
    labelKey: 'com_nav_setting_account',
    icon: createElement(UserIcon),
    sections: [
      { id: 'profile', labelKey: 'com_ui_settings_section_profile' },
      { id: 'security', labelKey: 'com_ui_settings_section_security' },
      { id: 'connections', labelKey: 'com_ui_settings_section_connections' },
      { id: 'billing', labelKey: 'com_ui_settings_section_billing' },
      { id: 'danger', labelKey: 'com_ui_settings_section_danger_zone', danger: true },
    ],
  },
  {
    id: SettingsTabValues.ABOUT,
    labelKey: 'com_nav_setting_about',
    icon: createElement(Info, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [{ id: 'about', labelKey: 'com_nav_setting_about' }],
    show: (ctx) => ctx.aboutEnabled,
  },
];
