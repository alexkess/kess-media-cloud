// Starter templates for new client sites. Content is placeholder copy written
// so the client can see structure before real copy arrives.

const contactPage = (name) => ({
  slug: 'contact', title: 'Contact', description: `Get in touch with ${name}. Send us a message and we will get back to you within one business day.`,
  sections: [
    { type: 'hero', style: 'light', eyebrow: 'Contact', heading: "Let's talk", accent: 'about your next step.', text: 'Send a message and we will reply within one business day.', image: '', imageAlt: '', ctaLabel: '', ctaHref: '' },
    { type: 'contact', heading: 'Send us', accent: 'a message', text: '', showPhone: true, submitLabel: 'Send message', successText: "Thanks, we'll be in touch soon." },
  ],
});

export const TEMPLATES = {
  service: {
    label: 'Service business',
    description: 'Home, About, Services, Contact. Suits trades, consultants, health and care providers.',
    theme: 'kess',
    pages: (name) => [
      { slug: '', title: 'Home', description: `${name} helps people get the right support, delivered with care. Find out what we do and how to get started.`, sections: [
        { type: 'hero', style: 'dark', eyebrow: name, heading: 'Support that fits', accent: 'how you live.', text: 'A short line that says who you help and what changes for them.', image: '', imageAlt: '', ctaLabel: 'Get in touch', ctaHref: 'contact' },
        { type: 'features', heading: 'What we', accent: 'do', items: [
          { title: 'Service one', text: 'One or two sentences about this service and who it is for.' },
          { title: 'Service two', text: 'One or two sentences about this service and who it is for.' },
          { title: 'Service three', text: 'One or two sentences about this service and who it is for.' },
        ] },
        { type: 'stats', items: [{ value: '10+', label: 'Years experience' }, { value: '500', label: 'Clients supported' }, { value: '4.9', label: 'Google rating' }] },
        { type: 'testimonials', heading: 'What people say', items: [{ quote: 'A short quote from a happy client.', name: 'Client name', role: 'Suburb' }] },
        { type: 'cta', heading: 'Ready to', accent: 'get started?', text: 'Tell us a little about what you need.', ctaLabel: 'Contact us', ctaHref: 'contact' },
      ] },
      { slug: 'about', title: 'About', description: `Meet the team behind ${name}: who we are, how we work and what we believe in.`, sections: [
        { type: 'hero', style: 'light', eyebrow: 'About us', heading: 'People first,', accent: 'always.', text: 'Introduce the team and the reason the business exists.', image: '', imageAlt: '', ctaLabel: '', ctaHref: '' },
        { type: 'text', heading: 'Our story', accent: '', body: 'Write two or three short paragraphs about how the business started.\n\nWhat you value, and how that shows up in the work.', tone: 'plain' },
        { type: 'faq', heading: 'Common questions', items: [{ q: 'Where do you work?', a: 'List the suburbs or regions you cover.' }, { q: 'How do I get started?', a: 'Explain the first step.' }] },
      ] },
      { slug: 'services', title: 'Services', description: `The services ${name} offers, who they are for, and what to expect when you work with us.`, sections: [
        { type: 'hero', style: 'light', eyebrow: 'Services', heading: 'Everything we offer,', accent: 'in one place.', text: '', image: '', imageAlt: '', ctaLabel: '', ctaHref: '' },
        { type: 'features', heading: 'Services', accent: '', items: [{ title: 'Service one', text: 'Detail.' }, { title: 'Service two', text: 'Detail.' }, { title: 'Service three', text: 'Detail.' }, { title: 'Service four', text: 'Detail.' }] },
        { type: 'cta', heading: 'Not sure', accent: 'what you need?', text: 'Ask us and we will point you in the right direction.', ctaLabel: 'Ask a question', ctaHref: 'contact' },
      ] },
      contactPage(name),
    ],
  },
  portfolio: {
    label: 'Portfolio',
    description: 'Home, Work, About, Contact. Suits photographers, designers, artists and studios.',
    theme: 'mono',
    pages: (name) => [
      { slug: '', title: 'Home', description: `Selected work by ${name}. Photography, design and creative projects for brands and people.`, sections: [
        { type: 'hero', style: 'dark', eyebrow: 'Portfolio', heading: name, accent: 'selected work.', text: 'A one-line statement about the work.', image: '', imageAlt: '', ctaLabel: 'See the work', ctaHref: 'work' },
        { type: 'gallery', heading: 'Recent', images: [] },
        { type: 'cta', heading: 'Have a project', accent: 'in mind?', text: '', ctaLabel: 'Get in touch', ctaHref: 'contact' },
      ] },
      { slug: 'work', title: 'Work', description: `Projects and case studies by ${name}, with the brief, the approach and the result for each.`, sections: [
        { type: 'hero', style: 'light', eyebrow: 'Work', heading: 'Projects', accent: '', text: '', image: '', imageAlt: '', ctaLabel: '', ctaHref: '' },
        { type: 'gallery', heading: '', images: [] },
      ] },
      { slug: 'about', title: 'About', description: `About ${name}: background, clients and approach.`, sections: [
        { type: 'text', heading: 'About', accent: '', body: 'A short bio.', tone: 'plain' },
        { type: 'testimonials', heading: 'Clients say', items: [] },
      ] },
      contactPage(name),
    ],
  },
  nonprofit: {
    label: 'Not-for-profit',
    description: 'Home, Programs, Get involved, Contact. Suits charities, community groups and associations.',
    theme: 'ocean',
    pages: (name) => [
      { slug: '', title: 'Home', description: `${name} works with the community to make a lasting difference. Learn about our programs and how to get involved.`, sections: [
        { type: 'hero', style: 'dark', eyebrow: name, heading: 'Stronger together,', accent: 'every day.', text: 'One line on your mission.', image: '', imageAlt: '', ctaLabel: 'Get involved', ctaHref: 'get-involved' },
        { type: 'stats', items: [{ value: '1,200', label: 'People supported' }, { value: '85', label: 'Volunteers' }, { value: '12', label: 'Programs' }] },
        { type: 'features', heading: 'Our', accent: 'programs', items: [{ title: 'Program one', text: 'Detail.' }, { title: 'Program two', text: 'Detail.' }, { title: 'Program three', text: 'Detail.' }] },
        { type: 'cta', heading: 'Make a', accent: 'difference', text: 'Volunteer, donate or partner with us.', ctaLabel: 'Get involved', ctaHref: 'get-involved' },
      ] },
      { slug: 'programs', title: 'Programs', description: `The programs ${name} runs, who they help and how to join.`, sections: [
        { type: 'hero', style: 'light', eyebrow: 'Programs', heading: 'What we', accent: 'run', text: '', image: '', imageAlt: '', ctaLabel: '', ctaHref: '' },
        { type: 'features', heading: '', accent: '', items: [{ title: 'Program one', text: 'Detail.' }] },
      ] },
      { slug: 'get-involved', title: 'Get involved', description: `Volunteer, donate or partner with ${name}. Here is how you can help.`, sections: [
        { type: 'text', heading: 'Get', accent: 'involved', body: 'Ways to help.', tone: 'plain' },
        { type: 'faq', heading: 'Volunteering FAQ', items: [{ q: 'Do I need experience?', a: 'No. We train every volunteer.' }] },
      ] },
      contactPage(name),
    ],
  },
  landing: {
    label: 'Single landing page',
    description: 'One page with hero, features, proof and a contact form. Suits campaigns and launches.',
    theme: 'kess',
    pages: (name) => [
      { slug: '', title: 'Home', description: `${name}: everything you need to know on one page, with a quick way to get in touch.`, sections: [
        { type: 'hero', style: 'dark', eyebrow: name, heading: 'One clear promise', accent: 'in a few words.', text: 'Who it is for and why it matters.', image: '', imageAlt: '', ctaLabel: 'Enquire now', ctaHref: '#contact' },
        { type: 'features', heading: 'Why', accent: 'choose us', items: [{ title: 'Benefit one', text: 'Detail.' }, { title: 'Benefit two', text: 'Detail.' }, { title: 'Benefit three', text: 'Detail.' }] },
        { type: 'testimonials', heading: 'Proof', items: [{ quote: 'Quote.', name: 'Name', role: '' }] },
        { type: 'faq', heading: 'Questions', items: [{ q: 'Question?', a: 'Answer.' }] },
        { type: 'contact', heading: 'Get in', accent: 'touch', text: '', showPhone: true, submitLabel: 'Send', successText: 'Thanks, talk soon.' },
      ] },
    ],
  },
};
