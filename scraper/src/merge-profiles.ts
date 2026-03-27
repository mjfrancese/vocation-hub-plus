/**
 * Merge deep scrape profile data into frontend-ready JSON.
 * Creates all-profiles.json with all 1,055 profiles for historical analysis.
 * Enriches active positions.json where possible.
 *
 * Usage: tsx src/merge-profiles.ts
 */

import fs from 'fs';
import path from 'path';

const PROFILES_DIR = path.resolve(__dirname, '../../data/profiles');
const WEB_DATA_DIR = path.resolve(__dirname, '../../web/public/data');

interface ProfileField {
  label: string;
  value: string;
}

interface RawProfile {
  id: number;
  url: string;
  fields: ProfileField[];
  fullText: string;
}

interface ChunkData {
  profiles: RawProfile[];
}

function main() {
  if (!fs.existsSync(PROFILES_DIR)) {
    console.log('No profiles directory found.');
    return;
  }

  // Load all profile chunks
  const allProfiles: RawProfile[] = [];
  const seen = new Set<number>();

  const chunkFiles = fs.readdirSync(PROFILES_DIR)
    .filter(f => f.startsWith('chunk-') && f.endsWith('.json'))
    .sort();

  for (const file of chunkFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8')) as ChunkData;
    for (const profile of data.profiles) {
      if (!seen.has(profile.id)) {
        seen.add(profile.id);
        allProfiles.push(profile);
      }
    }
  }

  console.log(`Loaded ${allProfiles.length} unique profiles from ${chunkFiles.length} chunks`);

  // Helper to get a field value
  const getField = (fields: ProfileField[], ...labels: string[]): string => {
    for (const label of labels) {
      const match = fields.find(f => f.label.toLowerCase() === label.toLowerCase());
      if (match?.value) return match.value;
    }
    // Partial match fallback
    for (const label of labels) {
      const lower = label.toLowerCase();
      const match = fields.find(f => f.label.toLowerCase().includes(lower));
      if (match?.value) return match.value;
    }
    return '';
  };

  // Helper to get a date field value, validating it looks like a date
  const getDateField = (fields: ProfileField[], ...labels: string[]): string => {
    const raw = getField(fields, ...labels);
    if (!raw) return '';
    // Accept MM/DD/YYYY or YYYY-MM-DD formats
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw) || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw;
    }
    return '';
  };

  // Transform profiles into frontend-friendly format
  const profilesForFrontend = allProfiles.map(p => {
    const f = p.fields;
    return {
      vh_id: p.id,
      profile_url: p.url,
      diocese: getField(f, 'Diocese'),
      congregation: getField(f, 'Congregation', 'Community Name', 'Name'),
      position_type: getField(f, 'Position Title/Role', 'Position Type'),
      status: getField(f, 'Current status'),
      order_of_ministry: getField(f, 'Order(s) of Ministry'),
      geographic_location: getField(f, 'Geographic Location'),
      work_environment: getField(f, 'Work Environment'),
      ministry_setting: getField(f, 'Ministry Setting'),
      avg_sunday_attendance: getField(f, 'Average Sunday Attendance'),
      annual_budget: getField(f, 'Annual Budget'),
      salary_range: getField(f, 'Range'),
      housing_type: getField(f, 'Type of Housing Provided'),
      pension: getField(f, 'Pension Plan'),
      healthcare: getField(f, 'Healthcare Options'),
      reimbursement: getField(f, 'Reimbursement Offered'),
      vacation: getField(f, 'Vacation & Leave Details'),
      leadership_skills: getField(f, 'Leadership skills'),
      ministry_skills: getField(f, 'Ministry skills'),
      languages: getField(f, 'Languages spoken'),
      contact_email: getField(f, 'Email Address') || getField(f, 'email'),
      receiving_names_from: getDateField(f, 'Receiving Names From', 'DatePicker 1'),
      receiving_names_to: getDateField(f, 'Receiving Names To', 'DatePicker 2'),
      open_ended: getField(f, 'Open Ended') === 'Yes',
      // Keep raw fields for full-text search
      all_fields: f,
    };
  });

  // Sort by VH ID descending (newest first)
  profilesForFrontend.sort((a, b) => b.vh_id - a.vh_id);

  // Write the profiles JSON
  if (!fs.existsSync(WEB_DATA_DIR)) {
    fs.mkdirSync(WEB_DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(
    path.join(WEB_DATA_DIR, 'all-profiles.json'),
    JSON.stringify(profilesForFrontend, null, 2)
  );

  // Stats
  const withDiocese = profilesForFrontend.filter(p => p.diocese).length;
  const withSalary = profilesForFrontend.filter(p => p.salary_range).length;
  const withAttendance = profilesForFrontend.filter(p => p.avg_sunday_attendance && p.avg_sunday_attendance !== '0').length;
  const withBudget = profilesForFrontend.filter(p => p.annual_budget && p.annual_budget !== '0').length;
  const withSkills = profilesForFrontend.filter(p => p.leadership_skills || p.ministry_skills).length;

  console.log(`\nWritten ${profilesForFrontend.length} profiles to all-profiles.json`);
  console.log(`  With diocese: ${withDiocese}`);
  console.log(`  With salary: ${withSalary}`);
  console.log(`  With attendance (non-zero): ${withAttendance}`);
  console.log(`  With budget (non-zero): ${withBudget}`);
  console.log(`  With skills: ${withSkills}`);
}

main();
