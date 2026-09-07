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
      'Template submitted. Approval is usually fast, but actual approval time depends on Meta.',
    customWarning:
      'Custom freeform messages may be subject to platform messaging rules and eligibility restrictions.',
  },
  actions: {
    syncNow: 'Sync Now',
    createBroadcast: 'Create Broadcast',
    connectFacebook: 'Connect Facebook',
    submitApproval: 'Submit for Approval',
    waitingApproval: 'Waiting for Approval',
    startBroadcast: 'Start Broadcast',
    fixResubmit: 'Fix & Resubmit',
  },
} as const;

export type Messages = typeof messages;
