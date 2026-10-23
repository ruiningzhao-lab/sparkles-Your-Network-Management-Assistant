import { findCity } from '@/lib/geo';
import type { Person, Place } from '@/lib/store/types';

// A sample network for trying Sparkles with no data of your own. Every sample person
// carries the "Sample" source tag so they can be removed in one go.
export const SAMPLE_TAG = 'Sample';
export const SAMPLE_HOME = 'San Francisco, United States';

type Row = [id: string, name: string, circle: string, city: string, role: string, company: string, tags: string, doing: string, note: string, daysAgo: number | null];

const ROWS: Row[] = [
  ['ana', 'Ana Ruiz', 'founders', 'Lisbon, Portugal', 'Founder', 'Maré Labs', 'climate, fundraising, surfing', 'Raising a seed round for ocean sensors', 'Met at Web Summit. Promised to send her our deck template.', 95],
  ['marcus', 'Marcus Lee', 'founders', 'Austin, United States', 'Founder', 'Fieldwork', 'startups, fundraising, bbq', 'Just closed a Series A', 'Shared his investor update template.', 35],
  ['ada', 'Ada Okoro', 'founders', 'Lagos, Nigeria', 'Founder', 'Paystack alumni fund', 'fintech, fundraising, music', 'Starting a pre-seed fund', 'Amara thinks we should meet.', null],
  ['amara', 'Amara Njoroge', 'founders', 'Nairobi, Kenya', 'Director', 'M-Kopa', 'fintech, solar, impact', 'Expanding to Nigeria', 'Wants advice on US fundraising.', 160],
  ['lena', 'Lena Vogel', 'founders', 'Berlin, Germany', 'Head of Growth', 'N26', 'growth, fintech, techno', 'Hiring a growth PM', 'Great intro source for fintech people in Europe.', 130],
  ['mira', 'Mira Chen', 'investors', 'New York City, United States', 'Partner', 'Lerer Hippeau', 'fundraising, consumer, pottery', 'Investing in consumer social', 'Intro via Yusuf. Interested in what we build next.', 60],
  ['yusuf', 'Yusuf Demir', 'investors', 'Istanbul, Turkey', 'Angel investor', '', 'fundraising, startups, chess', 'Writing a newsletter on Turkish startups', 'Always happy to make intros.', 14],
  ['omar', 'Omar Farouk', 'investors', 'Dubai, United Arab Emirates', 'Investor', 'BECO Capital', 'fundraising, fintech, padel', 'Looking at seed fintech in MENA', 'Met at a dinner in Dubai.', 240],
  ['grace', 'Grace Liu', 'investors', 'Singapore, Singapore', 'VP Product', 'Grab', 'product, fintech, climbing', 'Leading GrabPay product', 'Former colleague from Stripe.', 50],
  ['kai', 'Kai Nakamura', 'filmmakers', 'Tokyo, Japan', 'Product designer', 'Mercari', 'design, jazz piano, ramen', 'Learning jazz piano, plays at a bar in Shimokitazawa', 'College roommate. Wants to visit SF in spring.', 40],
  ['ethan', 'Ethan Park', 'filmmakers', 'Seoul, South Korea', 'Music producer', 'Studio Ethan', 'music, jazz, k-indie', 'Producing an indie album', 'Introduced me to the Seoul jazz scene.', 300],
  ['isabel', 'Isabel Cruz', 'filmmakers', 'Barcelona, Spain', 'Photographer', '', 'photography, travel, surfing', 'Shooting a travel series', 'Shot our team photos last year.', null],
  ['zoe', 'Zoe Martin', 'filmmakers', 'Oakland, United States', 'Illustrator', '', 'art, jazz, cats', 'Illustrating a children’s book', 'Lives 20 minutes away, we should hang out more.', 65],
  ['noor', 'Noor Haddad', 'filmmakers', 'Paris, France', 'Pastry chef', 'Du Pain et des Idées', 'cooking, baking, jazz', 'Opening her own bakery next year', 'Taught me how to make croissants.', 180],
  ['olivia', 'Olivia Brown', 'filmmakers', 'Sydney, Australia', 'Marine biologist', 'CSIRO', 'ocean, diving, climate', 'Researching coral restoration', 'Met on a dive trip in Bali.', 400],
  ['jo', 'Jo Martins', 'filmmakers', 'São Paulo, Brazil', 'Architect', 'Studio MK27', 'architecture, cooking, samba', 'Renovating her apartment', 'Cousin. Birthday in December.', 200],
  ['will', 'Will Turner', 'filmmakers', 'Portland, United States', 'Writer', '', 'books, running, film', 'Writing a novel', 'Met at a friend’s wedding.', 500],
  ['diego', 'Diego Herrera', 'engineers', 'Mexico City, Mexico', 'CTO', 'Kavak', 'engineering, ai, football', 'Scaling an AI pricing team', 'Spoke together on a panel in 2025.', 75],
  ['felix', 'Felix Wagner', 'engineers', 'Berlin, Germany', 'Engineer', 'Bosch', 'cars, ai, skiing', 'Working on driver-assist software', 'Asked about moving to the US.', 150],
  ['priya', 'Priya Raman', 'engineers', 'Bengaluru, India', 'Engineering manager', 'Razorpay', 'payments, mentoring, cricket', 'Mentoring first-time managers', 'Offered to review our hiring loop.', 21],
  ['sam', 'Sam Okafor', 'engineers', 'London, United Kingdom', 'Data scientist', 'DeepMind', 'ai, running, poetry', 'Training for the Berlin marathon', 'Ran the Bay to Breakers together in 2024.', 120],
  ['rachel', 'Rachel Kim', 'engineers', 'San Francisco, United States', 'Designer', 'Figma', 'design, ceramics, climbing', 'Designing collaboration tools', 'Coffee buddy in Hayes Valley.', 8],
  ['chen', 'Chen Wei', 'engineers', 'Shanghai, China', 'Product lead', 'ByteDance', 'product, ai, tea', 'Building AI creator tools', '', null],
  ['ben', 'Ben Adler', 'engineers', 'Toronto, Canada', 'Recruiter', 'Shopify', 'hiring, design, coffee', 'Hiring senior designers', 'Helped me hire two engineers.', 90],
  ['sofia', 'Sofia Rossi', 'filmmakers', 'Berlin, Germany', 'Jazz pianist', '', 'jazz piano, teaching, cycling', 'Teaching jazz piano online', 'Could score a short film together.', 210],
  ['tom', 'Tom Becker', 'engineers', 'Seattle, United States', 'Teacher', 'Garfield High', 'hiking, history, board games', 'Planning a Rainier trip', 'Brother-in-law.', 30],
  ['luca', 'Luca Bianchi', 'filmmakers', 'London, United Kingdom', 'Chef', 'Padella', 'cooking, wine, cycling', 'Running a pasta pop-up', 'Owes me a dinner.', 45],
  ['hana', 'Hana Sato', 'engineers', 'Osaka, Japan', 'Nurse', 'Osaka University Hospital', 'cooking, travel, gardening', 'Visiting Kyoto gardens this fall', 'Aunt. Loves photos from home.', 70],
];

const daysAgoIso = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

export function samplePeople(): Person[] {
  const now = Date.now();
  return ROWS.map(([id, n, m, city, role, company, tags, doing, note, days], i) => {
    const place: Place | null = city ? findCity(city) : null;
    const p: Person = {
      id: 'sample-' + id,
      n,
      m,
      role,
      company,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      doing,
      note,
      src: [SAMPLE_TAG],
      added: now - i * 36e5,
    };
    if (days != null) p.last = daysAgoIso(days);
    if (place) Object.assign(p, place);
    return p;
  });
}

export const sampleHome = () => findCity(SAMPLE_HOME);
export const isSample = (p: Person) => (p.src || []).includes(SAMPLE_TAG) || p.id.startsWith('sample-');
