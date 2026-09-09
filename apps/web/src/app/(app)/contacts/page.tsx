import { redirect } from 'next/navigation';

/** Contacts UI removed — send old bookmarks to broadcasts. */
export default function ContactsRemovedPage() {
  redirect('/broadcasts');
}
