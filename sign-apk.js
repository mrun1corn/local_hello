const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function sign() {
  try {
    console.log('Reading credentials...');
    const creds = fs.readFileSync('cred.txt', 'utf8');
    
    // Improved regex to capture multi-line base64
    // Matches from ANDROID_KEYSTORE= until the next ANDROID_ or end of file
    const ksMatch = creds.match(/ANDROID_KEYSTORE=([\s\S]*?)(?=ANDROID_|#|$)/);
    if (!ksMatch) throw new Error('No ANDROID_KEYSTORE found in cred.txt');

    console.log('Decoding keystore...');
    // Remove ALL whitespace (newlines, spaces) from the base64 string
    const base64 = ksMatch[1].replace(/\s/g, '');
    console.log(`Cleaned Base64 Length: ${base64.length}`);
    
    if (base64.length % 4 !== 0) {
      console.warn(`Warning: Base64 length ${base64.length} is not a multiple of 4. Might be missing padding or truncated.`);
    }

    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync('temp_release.jks', buf);
    console.log(`Keystore file written: ${buf.length} bytes`);

    const buildTools = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'build-tools', '35.0.0');
    const javaHome = "C:\\Program Files\\Android\\Android Studio\\jbr";
    const env = { 
      ...process.env, 
      JAVA_HOME: javaHome, 
      PATH: `${javaHome}\\bin;${process.env.PATH}` 
    };

    const unsignedApk = 'android/app/build/outputs/apk/release/app-release-unsigned.apk';
    const alignedApk = 'android/app/build/outputs/apk/release/app-release-aligned.apk';
    const signedApk = 'android/app/build/outputs/apk/release/app-release-signed.apk';

    console.log('--- Step 1: Zipalign ---');
    const zipalignPath = path.join(buildTools, 'zipalign.exe');
    execSync(`"${zipalignPath}" -v -f 4 "${unsignedApk}" "${alignedApk}"`, { stdio: 'ignore', env });
    console.log('Done.');

    console.log('--- Step 2: Apksigner ---');
    const apksignerPath = path.join(buildTools, 'apksigner.bat');
    execSync(`"${apksignerPath}" sign --ks temp_release.jks --ks-key-alias localchat --ks-pass pass:localchat123 --key-pass pass:localchat123 --out "${signedApk}" "${alignedApk}"`, { stdio: 'inherit', env });

    console.log('--- Step 3: Verification ---');
    execSync(`"${apksignerPath}" verify "${signedApk}"`, { stdio: 'inherit', env });

    console.log('\n✅ SUCCESS!');
    console.log(`Signed APK: ${signedApk}`);
    
    fs.unlinkSync('temp_release.jks');
  } catch (err) {
    console.error('\n❌ FAILED');
    console.error(err.message);
    if (fs.existsSync('temp_release.jks')) fs.unlinkSync('temp_release.jks');
    process.exit(1);
  }
}

sign();
