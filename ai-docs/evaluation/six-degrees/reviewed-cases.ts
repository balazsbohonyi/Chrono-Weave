// Reference review corpus only. Sources/expected routes are NEVER supplied to the production AI.
import type { HistoricalFigure } from '../../../src/types';
const p = (name: string, birthYear: number, deathYear: number): HistoricalFigure => ({ id: `eval-${name}`, name, birthYear, deathYear, occupation: 'Historical person', category: 'THINKERS' });
const people = {
  machiavelli: p('Niccolò Machiavelli',1469,1527), leonardo: p('Leonardo da Vinci',1452,1519),
  napoleon: p('Napoleon Bonaparte',1769,1821), wellington: p('Arthur Wellesley, Duke of Wellington',1769,1852),
  jobs: p('Steve Jobs',1955,2011), noyce: p('Robert Noyce',1927,1990), shockley: p('William Shockley',1910,1989),
  slater: p('John Clarke Slater',1900,1976), bohr: p('Niels Bohr',1885,1962), einstein: p('Albert Einstein',1879,1955),
  thomson: p('J. J. Thomson',1856,1940), rutherford: p('Ernest Rutherford',1871,1937),
  darwin: p('Charles Darwin',1809,1882), hooker: p('Joseph Dalton Hooker',1817,1911),
  newton: p('Isaac Newton',1643,1727), pepys: p('Samuel Pepys',1633,1703), locke: p('John Locke',1632,1704),
  faraday: p('Michael Faraday',1791,1867), maxwell: p('James Clerk Maxwell',1831,1879),
  king: p('Martin Luther King Jr.',1929,1968), hanh: p('Thich Nhat Hanh',1926,2022),
  hobbes: p('Thomas Hobbes',1588,1679), galileo: p('Galileo Galilei',1564,1642), bacon: p('Francis Bacon',1561,1626),
  wozniak: p('Steve Wozniak',1950,new Date().getFullYear()), hewlett: p('Bill Hewlett',1913,2001), packard: p('David Packard',1912,1996),
  zuckerberg: p('Mark Zuckerberg',1984,new Date().getFullYear()), mandela: p('Nelson Mandela',1918,2013), deklerk: p('F. W. de Klerk',1936,2021),
};
type PersonKey = keyof typeof people;
interface ReferenceContact { pair: [PersonKey, PersonKey]; basis: string; source: string; review: string }
export const referenceContacts: ReferenceContact[] = [
  {pair:['machiavelli','leonardo'],basis:'Machiavelli observed Leonardo working for Cesare Borgia and helped his Florentine engineering appointment.',source:'https://brunelleschi.imss.fi.it/itineraries/itinerary/TheReturnToFlorence.html',review:'Museo Galileo account; direct working connection, not merely Renaissance context.'},
  {pair:['napoleon','wellington'],basis:'Exact opposing commanders at Waterloo, 18 June 1815.',source:'https://www.nam.ac.uk/explore/battle-waterloo',review:'Named-battle exception; do not claim that they met.'},
  {pair:['jobs','noyce'],basis:'Noyce personally mentored Jobs.',source:'https://computerhistory.org/stories/silicon-valley/',review:'CHM describes mentoring; broader Silicon Valley membership alone would fail.'},
  {pair:['noyce','shockley'],basis:'Noyce worked directly under Shockley at his semiconductor laboratory in 1956–1957.',source:'https://www.computerhistory.org/siliconengine/silicon-comes-to-silicon-valley/',review:'Employer/employee working relationship, not merely employment somewhere in the same industry.'},
  {pair:['shockley','slater'],basis:'Slater advised Shockley’s 1936 MIT doctoral thesis.',source:'https://dspace.mit.edu/entities/publication/d5640e6f-c960-46e3-ad46-17b1dffd85e0',review:'MIT thesis record identifies the exact author and advisor.'},
  {pair:['slater','bohr'],basis:'Slater studied under Bohr in Copenhagen and worked with him on quantum theory.',source:'https://history.aip.org/history/catalog/icos/194.html',review:'AIP archival catalog and autobiographical collection https://history.aip.org/history/catalog/icos/3997.html. Catalog passages were available in search; full-page retrieval was intermittently unavailable.'},
  {pair:['bohr','einstein'],basis:'Bohr and Einstein met and discussed quantum theory; joint photographs also record their meetings.',source:'https://www.nobelprize.org/prizes/physics/1921/einstein/photo-gallery/',review:'Specific pair meeting, not an inference from membership of a large conference. Gallery metadata was available in search; full-page retrieval failed during this run.'},
  {pair:['bohr','thomson'],basis:'Bohr performed experimental work under Thomson’s guidance in Cambridge.',source:'https://www.nobelprize.org/prizes/physics/1922/bohr/biographical/',review:'Contemporaneous Nobel biography identifies personal guidance. Search passage available; full-page retrieval failed.'},
  {pair:['bohr','rutherford'],basis:'Bohr joined Rutherford in Manchester in 1912 and worked with him.',source:'https://history.aip.org/exhibits/rutherford/sections/alpha-particles-atom.html',review:'AIP historical account and Rutherford Nobel biography describe direct work, not only theoretical influence.'},
  {pair:['darwin','hooker'],basis:'They exchanged letters about species, including Hooker’s reply of 29 January 1844.',source:'https://www.darwinproject.ac.uk/letter?docId=letters%2FDCP-LETT-734.xml',review:'Primary correspondence in the Cambridge Darwin Correspondence Project.'},
  {pair:['newton','pepys'],basis:'Newton corresponded personally with Pepys, including his letter of 13 September 1693.',source:'https://www.newtonproject.ox.ac.uk/view/texts/diplomatic/OTHE00078',review:'Oxford transcription reproduces exact correspondence.'},
  {pair:['newton','locke'],basis:'Newton wrote personally to Locke, including an apology in September 1693.',source:'https://www.newtonproject.ox.ac.uk/view/texts/diplomatic/OTHE00078',review:'Oxford transcription reproduces exact correspondence.'},
  {pair:['faraday','maxwell'],basis:'Faraday’s correspondence includes exchanges with Maxwell.',source:'https://www.rigb.org/explore-science/explore/collection/michael-faradays-correspondence',review:'Royal Institution correspondence collection identifies Maxwell among the correspondents; influence through Faraday’s work alone is insufficient.'},
  {pair:['king','hanh'],basis:'They met in Chicago on 1 June 1966 and issued a joint statement.',source:'https://plumvillage.org/articles/thich-nhat-hanhs-friendship-with-dr-king',review:'First-person recollection and joint-statement record; exact meeting across regions/disciplines.'},
  {pair:['hobbes','galileo'],basis:'Hobbes met Galileo during his travels.',source:'https://www.hertford.ox.ac.uk/associate/thomas-hobbes-1588-1679/',review:'Oxford college historical biography explicitly names the encounter.'},
  {pair:['hobbes','bacon'],basis:'Hobbes worked with Bacon from 1621 to 1626.',source:'https://www.hertford.ox.ac.uk/associate/thomas-hobbes-1588-1679/',review:'Explicit direct working relationship.'},
  {pair:['jobs','wozniak'],basis:'They built Apple together; CHM records them testing the Apple I in the Jobs family garage in April 1976.',source:'https://computerhistory.org/stories/silicon-valley/',review:'Concrete collaboration and jointly pictured activity.'},
  {pair:['hewlett','packard'],basis:'Their company partnership included joint visits to the manufacturing floor.',source:'https://computerhistory.org/stories/silicon-valley/',review:'Specific joint activity, beyond being cofounders of the same institution.'},
  {pair:['jobs','zuckerberg'],basis:'Jobs personally imparted entrepreneurial lessons to Zuckerberg.',source:'https://computerhistory.org/stories/silicon-valley/',review:'CHM describes personal mentoring, not simply inspiration from Apple’s products.'},
  {pair:['mandela','deklerk'],basis:'They personally negotiated South Africa’s democratic transition.',source:'https://time.com/6116963/nelson-mandela-fw-de-klerk/',review:'Firsthand account by Richard Stengel, who worked with Mandela; includes Mandela’s description of his meeting with de Klerk.'},
];
const routes: PersonKey[][] = [
  ...referenceContacts.map(c => c.pair),
  ['einstein','bohr','slater','shockley','noyce','jobs'],
  ['thomson','bohr','slater','shockley','noyce','jobs'],
  ['rutherford','bohr','slater','shockley','noyce','jobs'],
];
export const reviewedCases = routes.map(route => ({
  from: people[route[0]], to: people[route[route.length - 1]], referenceRoute: route.map(key => people[key].name),
  referenceContacts: route.slice(1).map((next, i) => referenceContacts.find(c => c.pair.includes(route[i]) && c.pair.includes(next))!),
  review: 'Source-backed reference route; returned model routes still require independent review. Some catalog passages could only be inspected in search; expert confirmation remains useful.',
}));
export const unsupportedControls = [
  {from: people.einstein,to: people.newton,scope:'direct-link only',reason:'Non-overlapping lifespans block the direct edge; an indirect chain remains exploratory.'},
  {from: people.einstein,to: people.jobs,scope:'direct-link only',reason:'Year-level overlap is eligibility only; no direct encounter is supplied by the reference route.'},
  {from: people.darwin,to:p('Thomas Robert Malthus',1766,1834),scope:'direct-link only',reason:'Reading Malthus is influence through a work, not a supported personal interaction.'},
  {from:p('J. R. R. Tolkien',1892,1973),to:p('Adolf Hitler',1889,1945),scope:'direct-link only',reason:'Opposing armies in the First World War do not identify direct opposition between the exact pair in a named episode.'},
];
