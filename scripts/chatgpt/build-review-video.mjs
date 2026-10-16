import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=process.cwd();
const frames=resolve(root,'artifacts/chatgpt/walkthrough-frames');
const output=resolve(root,'public/review');
const temp=resolve(root,'artifacts/chatgpt/video-build');
await mkdir(output,{recursive:true});await mkdir(temp,{recursive:true});
const scenes=[
 ['01-context.png',10,'Read context: the authorized synthetic budget, wallets and categories. Nothing is saved.'],
 ...Array.from({length:12},(_,i)=>[`usd-live-${String(i).padStart(3,'0')}.png`,1,'Actual ChatGPT execution: saving a $20 grocery expense to the synthetic budget.']),
 ['02-usd-expense.png',10,'USD expense posted: $20 groceries from Cash USD. Demo data only.'],
 ['03-receipt.png',8,'Check the original save receipt. No replacement expense or duplicate is created.'],
 ['04-income.png',10,'Income posted: $500 into Cash USD, without an expense category.'],
 ['05-lbp.png',10,'LBP expense posted: 150,000 whole lira, preserving the Arabic memo.'],
 ['06-missing-amount.png',8,'Missing amount: ChatGPT asks for the amount instead of creating an expense.'],
 ['07-transfer.png',8,'Unsupported bank transfer: ChatGPT explains that the plugin cannot move money.'],
 ['08-read-only.png',8,'Explicit read-only request: available wallets are shown without saving anything.'],
];
let time=0;const cues=[];const clips=[];
const stamp=s=>`00:${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}.000`;
for (let i=0;i<scenes.length;i++) {
 const [file,duration,caption]=scenes[i];await readFile(resolve(frames,file));
 const clip=resolve(temp,`${i}.mp4`);clips.push(clip);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-loop','1','-i',resolve(frames,file),'-t',String(duration),'-vf','scale=1682:1004:force_original_aspect_ratio=decrease,pad=1682:1004:(ow-iw)/2:(oh-ih)/2','-r','15','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p',clip]);
 cues.push(`${stamp(time)} --> ${stamp(time+duration)}\n${caption}`);time+=duration;
}
const concat=resolve(temp,'clips.txt');await writeFile(concat,clips.map(p=>`file '${p}'`).join('\n'));
const silent=resolve(temp,'walkthrough.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concat,'-c','copy',silent]);
await writeFile(resolve(output,'walkthrough.vtt'),'WEBVTT\n\n'+cues.join('\n\n')+'\n');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',silent,'-i',resolve(output,'walkthrough.vtt'),'-c:v','copy','-c:s','mov_text','-metadata:s:s:0','language=eng','-disposition:s:0','default','-movflags','+faststart',resolve(output,'walkthrough.mp4')]);
const probe=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-show_streams','-of','json',resolve(output,'walkthrough.mp4')],{encoding:'utf8'}));
assert.ok(Math.abs(Number(probe.format.duration)-time)<1);assert.equal(probe.streams[0].codec_name,'h264');
console.log(`Created ${time}s captioned walkthrough; ${probe.format.size} bytes. Actual captures, edited with result holds; no simulated UI.`);
