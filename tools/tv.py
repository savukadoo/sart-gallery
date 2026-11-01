"""Normal signed Samsung developer installation. No root or shell injection."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'))
from aerotizen.sdb import Sdb
from aerotizen import signer, certs, catalog

APP_ID='SartGal001.Gallery'
MODEL='UA50DU7700WXXY'
MODELS=(MODEL,'QA55LS03BAWXXY')
VERSION=json.loads((ROOT/'package.json').read_text())['version']

def default_tv():
    configured=os.environ.get('SART_TV_HOST')
    if configured:
        return configured
    path=ROOT/'.local/developer-targets.json'
    return json.loads(path.read_text()).get('defaultTv') if path.exists() else None

def device(host,model=MODEL):
    if model not in MODELS:
        raise RuntimeError('This TV model is not registered for this project.')
    connection=Sdb(host,timeout=10).connect()
    if connection.banner != f'device::{model}::0':
        connection.close()
        raise RuntimeError(f'TV identity does not match the selected {model}. Refusing access.')
    return connection


def profile_for(duid):
    return ROOT/'.local'/'tv-profiles'/hashlib.sha256(duid.encode()).hexdigest()[:20]


def verify_install(output,applist):
    if re.search(r'\b(?:failed|failure|error|denied|cannot)\b|\bcan\s+not\b',output,re.I):
        raise RuntimeError('The TV reported an install error: '+output[-800:])
    installed=next((app for app in catalog.parse_applist(applist) if app['appid']==APP_ID),None)
    if not installed:
        raise RuntimeError('The TV does not list SART Gallery as installed.')
    if installed.get('version'):
        if installed['version']!=VERSION:
            raise RuntimeError('The TV reports an unexpected app version.')
        return {'installed':True,'version':VERSION,'version_verified':True}
    if not re.search(r'app_id\['+re.escape(APP_ID)+r'\]\s+install completed\b',output,re.I):
        raise RuntimeError('The TV did not confirm a completed installation.')
    return {'installed':True,'version_verified':False}


def main():
    parser=argparse.ArgumentParser(description='Sign, install and launch SART Gallery through Samsung’s normal developer interface.')
    parser.add_argument('action',choices=['status','certs','install','launch'])
    parser.add_argument('--tv',default=default_tv(),help='TV address; or set SART_TV_HOST/private local configuration')
    parser.add_argument('--model',choices=MODELS,default=MODEL,help='Exact owned TV model; identity is verified before access')
    parser.add_argument('--reuse-author-from',type=Path,help='Existing signing profile whose author identity and owned-TV permissions should be retained')
    parser.add_argument('--resume-sign-in',action='store_true',help='Resume an unfinished sign-in link from the last hour')
    args=parser.parse_args()
    if not args.tv:
        parser.error('Provide --tv ADDRESS or set SART_TV_HOST.')
    os.umask(0o077)
    if args.action=='status':
        with device(args.tv,args.model) as connection:
            duid=connection.duid();profile=profile_for(duid)
            print(json.dumps({'model':args.model,'banner':connection.banner,'developer_connection':True,
                              'signing_profile_present':all((profile/f).is_file() for f in ('author.p12','distributor.p12','device-profile.xml','password.txt'))},indent=2))
        return
    if args.action=='certs':
        with device(args.tv,args.model) as connection:
            profile=profile_for(connection.duid())
            duid=connection.duid()
        if (profile/'distributor.p12').exists():
            print('A signing profile already exists for this TV. It will be preserved.');return
        if args.model!=MODEL and not args.reuse_author_from:
            raise RuntimeError('An additional TV must retain the existing app author. Use --reuse-author-from.')
        profile.mkdir(parents=True,exist_ok=True,mode=0o700)
        # Use a fresh OAuth state and leave Samsung authentication to the human.
        certs.STATE=secrets.token_urlsafe(32)
        previous=ROOT/'.local'/'samsung-sign-in-url.txt'
        if args.resume_sign_in and previous.exists() and time.time()-previous.stat().st_mtime<3600:
            parsed=urllib.parse.urlsplit(previous.read_text().strip())
            query=urllib.parse.parse_qs(parsed.query)
            state=query.get('state',[''])[0]
            if parsed.hostname=='account.samsung.com' and re.fullmatch(r'[A-Za-z0-9_-]{30,100}',state) and query.get('redirect_uri')==['http://localhost:4794/signin/callback']:
                certs.STATE=state
        original_login=certs.samsung_login
        certs.samsung_login=lambda:original_login(timeout=1200)
        def capture_url(url):
            path=ROOT/'.local'/'samsung-sign-in-url.txt';path.write_text(url+'\n');path.chmod(0o600)
            print('Samsung sign-in URL is ready in .local/samsung-sign-in-url.txt',flush=True)
            return True
        certs.webbrowser.open=capture_url
        if args.reuse_author_from:
            from tv_signing import create_with_existing_author
            create_with_existing_author(duid,profile,args.reuse_author_from)
        else:
            certs.create_profile(duid,str(profile))
        for path in profile.iterdir():path.chmod(0o600)
        print(f'Samsung-issued signing certificates saved for {args.model}.',flush=True)
        return
    if args.action=='install':
        with device(args.tv,args.model) as connection:
            duid=connection.duid();profile=profile_for(duid)
            if not all((profile/f).is_file() for f in ('author.p12','distributor.p12','device-profile.xml','password.txt')):
                raise RuntimeError('Samsung sign-in and certificate creation must complete first. Run tools/tv.py certs.')
            unsigned=ROOT/'dist'/f'SART-Gallery-{VERSION}-unsigned.wgt'
            if not unsigned.is_file():raise RuntimeError('Build the widget first with tools/package_app.py.')
            signed=ROOT/'dist'/f'SART-Gallery-{VERSION}-signed.wgt'
            signer.sign_wgt(str(unsigned),str(signed),str(profile))
            tool_path=connection.capability().get('sdk_toolpath','/home/owner/share/tmp/sdk_tools')
            if not re.fullmatch(r'/[A-Za-z0-9_./-]+',tool_path):raise RuntimeError('Unexpected SDK staging path.')
            # A museum-image bundle can take longer than the short discovery timeout
            # to transfer, verify and unpack on the TV.
            connection.sock.settimeout(120)
            connection.push((profile/'device-profile.xml').read_bytes(),tool_path+'/device-profile.xml')
            remote=f'{tool_path}/{APP_ID.split(".")[0]}.wgt'
            print(f'Sending signed SART Gallery {VERSION} ({signed.stat().st_size/1_000_000:.1f} MB)…',flush=True)
            connection.push(signed.read_bytes(),remote)
            print('The TV is verifying and installing the update…',flush=True)
            output=connection.shell(f'0 vd_appinstall {APP_ID} {remote}')
            report=verify_install(output,connection.applist())
            report.update({'appId':APP_ID,'model':args.model,'packageSha256':hashlib.sha256(signed.read_bytes()).hexdigest(),'root_used':False})
            (ROOT/'.local'/f'installation-{args.model}.json').write_text(json.dumps(report,indent=2)+'\n')
            if args.model==MODEL:
                (ROOT/'.local'/'installation.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
        return
    if args.action=='launch':
        with device(args.tv,args.model):
            pass
        request=urllib.request.Request(f'http://{args.tv}:8001/api/v2/applications/{APP_ID}',data=b'',method='POST')
        with urllib.request.urlopen(request,timeout=10) as response:
            response.read()
        def read_state():
            request=urllib.request.Request(f'http://{args.tv}:8001/api/v2/applications/{APP_ID}')
            with urllib.request.urlopen(request,timeout=10) as response:
                return json.load(response)
        for attempt in range(20):
            status=read_state()
            if status.get('running') and status.get('visible'):break
            if attempt==5:
                with device(args.tv,args.model) as connection:
                    connection.launch(APP_ID)
            time.sleep(.5)
        if not (status.get('running') and status.get('visible')):
            raise RuntimeError('The TV did not confirm SART Gallery is visible.')
        print(json.dumps({'appId':APP_ID,'reported_state':status},indent=2))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(type(error).__name__+': '+str(error),file=sys.stderr);raise SystemExit(1)
