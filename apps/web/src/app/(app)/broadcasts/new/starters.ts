export const STARTER_COPY = [
  {
    id: 'account_update',
    name: 'castme_account_update_v1',
    title: 'Account update',
    body: 'Hi {{1}}, your account status was updated: {{2}}.',
    parameters: ['name', 'status'],
  },
  {
    id: 'order_status',
    name: 'castme_order_status_v1',
    title: 'Order status',
    body: 'Hi {{1}}, your order {{2}} is now {{3}}.',
    parameters: ['name', 'order_id', 'status'],
  },
  {
    id: 'appointment_reminder',
    name: 'castme_appointment_v1',
    title: 'Appointment reminder',
    body: 'Hi {{1}}, reminder: your appointment is on {{2}}.',
    parameters: ['name', 'datetime'],
  },
];
