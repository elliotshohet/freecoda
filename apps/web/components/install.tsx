'use client';
import {useState} from 'react';
import {Check, Copy, ArrowUpRight, Terminal} from 'lucide-react';
import Link from 'next/link';
export function Install({compact=false}:{compact?:boolean}) {const [copied,setCopied]=useState(false); const command='npm install -g @freecoda/cli';return <div className={compact?'install compact':'install'}><div className="install-command"><Terminal size={17}/><code>{command}</code><button aria-label="Copy install command" onClick={async()=>{try{await navigator.clipboard.writeText(command);setCopied(true);setTimeout(()=>setCopied(false),1800)}catch{setCopied(false)}}}>{copied?<Check size={17}/>:<Copy size={17}/>}</button></div>{!compact&&<div className="install-note">Local preview release <span>·</span> <Link href="/docs#installation">Install from source <ArrowUpRight size={12}/></Link></div>}</div>}
