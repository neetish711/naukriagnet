import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  console.log('\nNaukriAgent Setup');
  console.log('====================\n');

  const dirs = ['data/sessions', 'data/logs'];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created: ${dir}`);
    }
  }

  if (!fs.existsSync('.env')) {
    console.log('\nCreating .env file from template...');
    const template = fs.readFileSync('.env.example', 'utf-8');
    fs.writeFileSync('.env', template);
    console.log('.env created. Please fill in your credentials.\n');
  }

  console.log('\nSetup Checklist:');
  console.log('  1. Edit .env with your Google Cloud credentials');
  console.log('  2. Edit profile.json with your details');
  console.log('  3. Place your resume.pdf in the project root');
  console.log('  4. Run: npm run login (to authenticate LinkedIn)');
  console.log('  5. Run: npm run dev (to start the dashboard)');
  console.log('  6. Visit: http://localhost:3000/api/gmail/auth (to connect Gmail)');
  console.log('\nSetup complete!\n');

  rl.close();
}

main().catch(console.error);
