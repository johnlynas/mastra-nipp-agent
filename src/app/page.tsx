import { redirect } from 'next/navigation';

/**
 * Landing page — straight to the chat (DESIGN §6.1).
 */
export default function Home() {
  redirect('/chat');
}
