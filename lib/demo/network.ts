import { findCity } from '@/lib/geo';
import type { Person, Place } from '@/lib/store/types';

// A sample network for trying Sparkles with no data of your own. Every sample person
// carries the "Sample" source tag so they can be removed in one go.
export const SAMPLE_TAG = 'Sample';
export const SAMPLE_HOME = 'San Francisco, United States';

type Row = [id: string, name: string, circle: string, city: string, role: string, company: string, tags: string, doing: string, note: string, daysAgo: number | null];

const ROWS: Row[] = [
  ['ana', 'Ana Ruiz', 'work', 'Lisbon, Portugal', 'Founder', 'Maré Labs', 'climate, fundraising, surfing', 'Raising a seed round for ocean sensors', 'Met at Web Summit. Promised to send her our deck template.', 95],
  ['kai', 'Kai Nakamura', 'friends', 'Tokyo, Japan', 'Product designer', 'Mercari', 'design, jazz piano, ramen', 'Learning jazz piano, plays at a bar in Shimokitazawa', 'College roommate. Wants to visit SF in spring.', 40],
  ['lena', 'Lena Vogel', 'work', 'Berlin, Germany', 'Head of Growth', 'N26', 'growth, fintech, techno', 'Hiring a growth PM', 'Great intro source for fintech people in Europe.', 130],
  ['sam', 'Sam Okafor', 'friends', 'London, United Kingdom', 'Data scientist', 'DeepMind', 'ai, running, poetry', 'Training for the Berlin marathon', 'Ran the Bay to Breakers together in 2024.', 120],
  ['priya', 'Priya Raman', 'work', 'Bengaluru, India', 'Engineering manager', 'Razorpay', 'payments, mentoring, cricket', 'Mentoring first-time managers', 'Offered to review our hiring loop.', 21],
  ['mira', 'Mira Chen', 'work', 'New York City, United States', 'Partner', 'Lerer Hippeau', 'fundraising, consumer, pottery', 'Investing in consumer social', 'Intro via Yusuf. Interested in what we build next.', 60],
  ['yusuf', 'Yusuf Demir', 'work', 'Istanbul, Turkey', 'Angel investor', '', 'fundraising, startups, chess', 'Writing a newsletter on Turkish startups', 'Always happy to make intros.', 14],
  ['jo', 'Jo Martins', 'family', 'São Paulo, Brazil', 'Architect', 'Studio MK27', 'architecture, cooking, samba', 'Renovating her apartment', 'Cousin. Birthday in December.', 200],
  ['tom', 'Tom Becker', 'family', 'Seattle, United States', 'Teacher', 'Garfield High', 'hiking, history, board games', 'Planning a Rainier trip', 'Brother-in-law.', 30],
  ['noor', 'Noor Haddad', 'friends', 'Paris, France', 'Pastry chef', 'Du Pain et des Idées', 'cooking, baking, jazz', 'Opening her own bakery next year', 'Taught me how to make croissants.', 180],
  ['diego', 'Diego Herrera', 'work', 'Mexico City, Mexico', 'CTO', 'Kavak', 'engineering, ai, football', 'Scaling an AI pricing team', 'Spoke together on a panel in 2025.', 75],
  ['amara', 'Amara Njoroge', 'work', 'Nairobi, Kenya', 'Director', 'M-Kopa', 'fintech, solar, impact', 'Expanding to Nigeria', 'Wants advice on US fundraising.', 160],
  ['ethan', 'Ethan Park', 'friends', 'Seoul, South Korea', 'Music producer', 'Studio Ethan', 'music, jazz, k-indie', 'Producing an indie album', 'Introduced me to the Seoul jazz scene.', 300],
  ['grace', 'Grace Liu', 'work', 'Singapore, Singapore', 'VP Product', 'Grab', 'product, fintech, climbing', 'Leading GrabPay product', 'Former colleague from Stripe.', 50],
  ['olivia', 'Olivia Brown', 'friends', 'Sydney, Australia', 'Marine biologist', 'CSIRO', 'ocean, diving, climate', 'Researching coral restoration', 'Met on a dive trip in Bali.', 400],
  ['ben', 'Ben Adler', 'work', 'Toronto, Canada', 'Recruiter', 'Shopify', 'hiring, design, coffee', 'Hiring senior designers', 'Helped me hire two engineers.', 90],
  ['sofia', 'Sofia Rossi', 'friends', 'Berlin, Germany', 'Jazz pianist', '', 'jazz piano, teaching, cycling', 'Teaching jazz piano online', 'Could be a great piano teacher for me.', 210],
  ['marcus', 'Marcus Lee', 'work', 'Austin, United States', 'Founder', 'Fieldwork', 'startups, fundraising, bbq', 'Just closed a Series A', 'Shared his investor update template.', 35],
  ['hana', 'Hana Sato', 'family', 'Osaka, Japan', 'Nurse', 'Osaka University Hospital', 'cooking, travel, gardening', 'Visiting Kyoto gardens this fall', 'Aunt. Loves photos from home.', 70],
  ['luca', 'Luca Bianchi', 'friends', 'London, United Kingdom', 'Chef', 'Padella', 'cooking, wine, cycling', 'Running a pasta pop-up', 'Owes me a dinner.', 45],
  ['rachel', 'Rachel Kim', 'work', 'San Francisco, United States', 'Designer', 'Figma', 'design, ceramics, climbing', 'Designing collaboration tools', 'Coffee buddy in Hayes Valley.', 8],
  ['omar', 'Omar Farouk', 'work', 'Dubai, United Arab Emirates', 'Investor', 'BECO Capital', 'fundraising, fintech, padel', 'Looking at seed fintech in MENA', 'Met at a dinner in Dubai.', 240],
  ['zoe', 'Zoe Martin', 'friends', 'Oakland, United States', 'Illustrator', '', 'art, jazz, cats', 'Illustrating a children’s book', 'Lives 20 minutes away, we should hang out more.', 65],
  ['felix', 'Felix Wagner', 'work', 'Berlin, Germany', 'Engineer', 'Bosch', 'cars, ai, skiing', 'Working on driver-assist software', 'Asked about moving to the US.', 150],
  ['isabel', 'Isabel Cruz', 'friends', 'Barcelona, Spain', 'Photographer', '', 'photography, travel, surfing', 'Shooting a travel series', 'Shot our team photos last year.', null],
  ['chen', 'Chen Wei', 'work', 'Shanghai, China', 'Product lead', 'ByteDance', 'product, ai, tea', 'Building AI creator tools', '', null],
  ['ada', 'Ada Okoro', 'work', 'Lagos, Nigeria', 'Founder', 'Paystack alumni fund', 'fintech, fundraising, music', 'Starting a pre-seed fund', 'Amara thinks we should meet.', null],
  ['will', 'Will Turner', 'friends', '', 'Writer', '', 'books, running', 'Writing a novel', 'Met at a friend’s wedding. Not sure where he lives now.', 500],
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
