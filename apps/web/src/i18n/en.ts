export const messages = {
  appName: 'CastMe Pro',
  tagline: 'Customer messaging & broadcast management',
  nav: {
    dashboard: 'Dashboard',
    broadcasts: 'Broadcasts',
    contacts: 'Contacts',
    analytics: 'Analytics',
    settings: 'Settings',
    reconnect: 'Reconnect',
    support: 'Support',
    notifications: 'Notifications',
    activity: 'Activity Logs',
    billing: 'Billing',
    team: 'Team',
    admin: 'Admin',
  },
  empty: {
    contacts: 'No customers synced yet.',
    broadcasts: "You haven't created your first broadcast yet.",
    pages: 'Connect a Facebook Page to get started.',
  },
  approval: {
    waiting:
      'Activating Messenger templates for this Page…',
    ready:
      'Template is approved for this Page. You can start the broadcast now.',
    customWarning:
      'Custom freeform messages may be subject to platform messaging rules and eligibility restrictions.',
  },
  actions: {
    syncNow: 'Sync Now',
    createBroadcast: 'Create Broadcast',
    connectFacebook: 'Connect Facebook',
    submitApproval: 'Activate template',
    waitingApproval: 'Activating…',
    startBroadcast: 'Start Broadcast',
    fixResubmit: 'Activate again',
    logout: 'Log out',
  },
} as const;

export type Messages = typeof messages;
