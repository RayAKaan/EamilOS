const GREETINGS = [
  'hello', 'hi', 'hey', 'greetings', 'howdy', 'yo', 'sup',
  'good morning', 'good afternoon', 'good evening',
  'what\'s up', 'wassup', 'whassup',
  'hiya', 'heya', 'how are you',
  'konnichiwa', 'hola', 'bonjour', 'namaste', 'ciao',
  'salut', 'hallo', 'ola', 'marhaba',
];

export function isGreeting(input: string): boolean {
  const lower = input.toLowerCase().trim();
  if (GREETINGS.some(g => lower.startsWith(g) || lower === g)) return true;
  const firstWord = lower.split(/\s+/)[0];
  if (!firstWord) return false;
  return GREETINGS.some(g => firstWord === g || firstWord.startsWith(g));
}
