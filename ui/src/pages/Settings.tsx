import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GeneralSettings } from './GeneralSettings';
import { Organizations } from './Organizations';
import { EmailSettings } from './EmailSettings';
import { LlmSettings } from './LlmSettings';
import { SlackSettings } from './SlackSettings';
import { TeamsSettings } from './TeamsSettings';
import { TelegramSettings } from './TelegramSettings';
import { DesktopAlerts } from './DesktopAlerts';

/**
 * Everything configurable, one tab at a time.
 *
 * Stacking every integration on a single page made it long enough that the
 * bottom of it was never seen, so each one gets its own tab and its own URL —
 * `/settings/slack` is a link you can send someone.
 */
type TabId =
  | 'general'
  | 'organizations'
  | 'slack'
  | 'teams'
  | 'telegram'
  | 'email'
  | 'desktop'
  | 'model';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'slack', label: 'Slack' },
  { id: 'teams', label: 'Teams' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'email', label: 'Email' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'model', label: 'Model' },
];

const DEFAULT_TAB: TabId = 'general';

function isTab(value: string | undefined): value is TabId {
  return TABS.some(tab => tab.id === value);
}

export function Settings({ onAuthLost }: { onAuthLost: () => void }) {
  const { tab } = useParams();
  // An unknown tab in the URL falls back rather than rendering nothing.
  const active: TabId = isTab(tab) ? tab : DEFAULT_TAB;

  const panels: Record<TabId, ReactNode> = {
    general: <GeneralSettings onAuthLost={onAuthLost} />,
    organizations: <Organizations onAuthLost={onAuthLost} />,
    slack: <SlackSettings onAuthLost={onAuthLost} />,
    teams: <TeamsSettings onAuthLost={onAuthLost} />,
    telegram: <TelegramSettings onAuthLost={onAuthLost} />,
    email: <EmailSettings onAuthLost={onAuthLost} />,
    desktop: <DesktopAlerts onAuthLost={onAuthLost} />,
    model: <LlmSettings onAuthLost={onAuthLost} />,
  };

  return (
    <>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(item => (
          <Link
            key={item.id}
            to={`/settings/${item.id}`}
            className={item.id === active ? 'active' : ''}
            aria-current={item.id === active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {panels[active]}
    </>
  );
}
