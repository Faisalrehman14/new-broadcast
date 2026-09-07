/**
 * Seed data for all PageBroadcast templates.
 * Library templates without supplied bodies keep body_status = requires_import.
 */

export type SeedTemplate = {
  title: string;
  metaName: string;
  category: string;
  body: string | null;
  bodyStatus: 'ready' | 'requires_import';
  source: 'PAGEINTERACT' | 'LIBRARY' | 'CUSTOM';
  isCustom: boolean;
};

export const SEED_TEMPLATES: SeedTemplate[] = [
  // Core PageInteract (10)
  {
    title: 'Plan Activated Checklist',
    metaName: 'pi_order_status_premimum',
    category: 'Premium',
    body: `Hi {{1}} 👏
Your {{2}} is activate right now... 
✅ {{3}}
✅ {{4}}
✅ {{5}}
✅ {{6}}
Reply if you have any questions.`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Daily Summary Report',
    metaName: 'pi_daily_summary_update',
    category: 'Premium',
    body: `Hi {{1}}, 
Here is your daily {{2}} summary: 
✅ {{3}}
✅ {{4}}
✅ {{5}}
Let us know if you need help! 💬`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Account Now Active',
    metaName: 'pi_account_status_active',
    category: 'Starter',
    body: `Hello  {{1}}👀,
Your {{2}} is now ACTIVE. ✅
💸 {{3}}
🏆 {{4}}
Reply if you have any questions. ❤`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Ticket Resolved',
    metaName: 'pi_support_ticket',
    category: 'Basic',
    body: `Hi {{1}}, 🔥🔥
  
Your ✅ {{2}} is resolved. ✅
  
👀 {{3}} 👀
Reply if you have any questions. ❤`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Delivery Arrived',
    metaName: 'pi_delivery_confirmation',
    category: 'Basic',
    body: `🔥 Hey {{1}}, 🔥
  
✅✅ Your {{2}} has arrived. ✅✅
  
{{3}} 🎁
Reply if you have any questions.`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Balance Confirmed',
    metaName: 'pi_account_update',
    category: 'Basic',
    body: `Hello {{1}},❤
  
Your {{2}} confirmed.✅✅
  
{{3}}
Reply if you have any questions.❤`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Wallet Updated',
    metaName: 'pi_account_notification',
    category: 'Basic',
    body: `Hello {{1}}, ❤❤
✅ {{2}} has been updated✅
{{3}} ⏳
Reply if you have any questions. ❤`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Payment Complete',
    metaName: 'pi_invoice_status',
    category: 'Basic',
    body: `Hi {{1}} ,👀
💸Your {{2}} is complete.✅✅
{{3}}  🎉
Reply if you have any questions.`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Order Ready + CTA',
    metaName: 'pi_order_confirmation',
    category: 'Basic',
    body: `Hi {{1}},  #{{2}} is ready🔥🔥
📩 Say yes if you want {{3}}`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },
  {
    title: 'Quick Confirmation',
    metaName: 'pi_order_confirm_2',
    category: 'Simple',
    body: `🔥 Hi your {{1}}, is Now confirmed✅`,
    bodyStatus: 'ready',
    source: 'PAGEINTERACT',
    isCustom: false,
  },

  // Library extras with bodies (5)
  {
    title: 'Account Update + Offer',
    metaName: 'pi_lib_28',
    category: 'Library',
    body: `Hi {{1}}, ❤❤
💎 there’s an update on your account: 
🏆 {{2}}
🔔 {{3}}
💸 {{4}}
💵 {{5}}
✅ {{6}}
Reply yes if you Want {{7}}📩`,
    bodyStatus: 'ready',
    source: 'LIBRARY',
    isCustom: false,
  },
  {
    title: 'Activation Rewards',
    metaName: 'pi_lib_27',
    category: 'Library',
    body: `Hey {{1}} 🔥, 
{{2}} just got ACTIVATED. 🎉
Now Get : 
🎯 {{3}}
🎯 {{4}}
🎯 {{5}}
Reply if you need any assistance.`,
    bodyStatus: 'ready',
    source: 'LIBRARY',
    isCustom: false,
  },
  {
    title: 'Bonus Activated',
    metaName: 'pi_lib_26',
    category: 'Library',
    body: `Hello {{1}} 🎁, {{2}} has been ACTIVATED for you! ❤`,
    bodyStatus: 'ready',
    source: 'LIBRARY',
    isCustom: false,
  },
  {
    title: 'Player Status Update',
    metaName: 'pi_lib_25',
    category: 'Library',
    body: `Hello {{1}} 👋
Your player status has been updated.
✅ {{2}}
🎁  {{3}}
⚡  {{4}}
Reply if you need any assistance.`,
    bodyStatus: 'ready',
    source: 'LIBRARY',
    isCustom: false,
  },
  {
    title: 'Now Active One-Liner',
    metaName: 'pi_lib_24',
    category: 'Library',
    body: `Hello {{1}} ❤❤,
{{2}} is now ACTIVE. 💸`,
    bodyStatus: 'ready',
    source: 'LIBRARY',
    isCustom: false,
  },

  // Library extras requiring import (13)
  { title: 'Order Confirmed Details', metaName: 'pi_lib_22', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Status Update List', metaName: 'pi_lib_21', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Checklist Announcement', metaName: 'pi_lib_20', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Confirmed + Offer CTA', metaName: 'pi_lib_19', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Gift Confirmed CTA', metaName: 'pi_lib_18', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Update Completed Note', metaName: 'pi_lib_17', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Order Ready Note', metaName: 'pi_lib_13', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Account Summary Points', metaName: 'pi_lib_12', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Order Confirmation Steps', metaName: 'pi_lib_10', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Payment Confirmed CTA', metaName: 'pi_lib_8', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Account Info Updated', metaName: 'pi_lib_5', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Info Refreshed Details', metaName: 'pi_lib_4', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },
  { title: 'Status Updated Details', metaName: 'pi_lib_3', category: 'Library', body: null, bodyStatus: 'requires_import', source: 'LIBRARY', isCustom: false },

  // Custom placeholder (not Meta-named)
  {
    title: 'Custom',
    metaName: 'custom_freeform',
    category: 'Custom',
    body: '',
    bodyStatus: 'ready',
    source: 'CUSTOM',
    isCustom: true,
  },
];
