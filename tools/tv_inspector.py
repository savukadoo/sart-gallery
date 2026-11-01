"""Temporarily expose only SART Gallery's standard SDK inspector on loopback."""
from pathlib import Path
import argparse
import http.client
import json
import os
import signal
import threading
import time
import urllib.request

from tv import device, APP_ID, MODEL, MODELS, default_tv

ROOT=Path(__file__).resolve().parents[1]


def app_request(host,method):
    request=urllib.request.Request(f'http://{host}:8001/api/v2/applications/{APP_ID}',method=method,data=b'' if method=='POST' else None)
    try:
        with urllib.request.urlopen(request,timeout=8) as response:
            return response.read().decode()
    except (OSError, http.client.HTTPException):
        return None


def interrupted(_signum,_frame):
    raise KeyboardInterrupt


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--tv',default=default_tv(),help='TV address; or set SART_TV_HOST/private local configuration')
    parser.add_argument('--model',choices=MODELS,default=MODEL)
    parser.add_argument('--port',type=int,default=9223)
    parser.add_argument('--seconds',type=int,default=600)
    parser.add_argument('--stop',action='store_true',help='Close this project’s temporary inspector and return to normal launch')
    parser.add_argument('--leave-native-art',action='store_true',help='Frame only: after a verified native handoff, close hidden SART without returning it to the foreground')
    args=parser.parse_args()
    if not args.tv:
        parser.error('Provide --tv ADDRESS or set SART_TV_HOST.')
    if args.leave_native_art and args.model!='QA55LS03BAWXXY':
        parser.error('--leave-native-art requires the owned Frame model')
    suffix='' if args.model==MODEL else '-'+args.model
    stop_file=ROOT/'.local'/f'tv-inspector{suffix}.stop'
    closed_file=ROOT/'.local'/f'tv-inspector{suffix}-closed.json'
    if args.stop:
        stop_file.write_text('stop\n')
        requested=stop_file.stat().st_mtime
        for _ in range(40):
            if closed_file.exists() and closed_file.stat().st_mtime>=requested:return
            time.sleep(.25)
        return
    stop_file.unlink(missing_ok=True)
    closed_file.unlink(missing_ok=True)
    signal.signal(signal.SIGTERM,interrupted)
    finished=threading.Event()
    def watch_stop():
        while not finished.wait(.5):
            if stop_file.exists():
                os.kill(os.getpid(),signal.SIGTERM)
                return
    threading.Thread(target=watch_stop,daemon=True).start()
    timer=threading.Timer(min(max(args.seconds,30),1200),lambda:os.kill(os.getpid(),signal.SIGTERM))
    timer.daemon=True
    restore_needed=False
    try:
        with device(args.tv,args.model) as connection:
            restore_needed=True
            app_request(args.tv,'DELETE')
            for _ in range(12):
                raw=app_request(args.tv,'GET')
                if raw:
                    try:
                        if not json.loads(raw).get('running'):break
                    except ValueError:pass
                time.sleep(.3)
            connection.sock.settimeout(45)
            debug_output=[]
            original_recv=connection._recv
            def read_debug_packet():
                packet=original_recv()
                if packet[0]==int.from_bytes(b'WRTE','little'):debug_output.append(packet[3].decode(errors='replace'))
                return packet
            connection._recv=read_debug_packet
            try:remote_port=connection.debug_launch(APP_ID)
            finally:connection._recv=original_recv
            (ROOT/'.local'/f'tv-debug-launch{suffix}.txt').write_text(''.join(debug_output))
            report={'appId':APP_ID,'model':args.model,'host':args.tv,'tvPort':remote_port,'localPort':args.port,'pid':os.getpid(),'rootUsed':False}
            (ROOT/'.local'/f'tv-inspector{suffix}.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report),flush=True)
            # The older Frame can start an SDK debug session in the background.
            # Resume this same app before input/layout checks; do not inspect a
            # suspended page while the TV is displaying another screen.
            app_request(args.tv,'POST')
            if args.model=='QA55LS03BAWXXY':
                raw=app_request(args.tv,'GET')
                foreground=json.loads(raw) if raw else {}
                if not foreground.get('visible'):
                    # The Frame can acknowledge a REST launch without resuming
                    # its debug window. Use the same normal SDK app-launch verb
                    # as tv.py before handing this one SDB session to forwarding.
                    connection.launch(APP_ID)
            timer.start()
            connection.forward(args.port,remote_port)
    except KeyboardInterrupt:
        print('SART inspector stopped.',flush=True)
    finally:
        finished.set()
        timer.cancel()
        if restore_needed:
            raw=app_request(args.tv,'GET') if args.leave_native_art else None
            previous=json.loads(raw) if raw else {}
            preserve_native=args.leave_native_art and previous.get('running') and not previous.get('visible')
            app_request(args.tv,'DELETE')
            time.sleep(.3)
            if not preserve_native:
                app_request(args.tv,'POST')
            for attempt in range(15):
                raw=app_request(args.tv,'GET')
                status=json.loads(raw) if raw else {}
                if preserve_native and not status.get('running'):break
                if not preserve_native and status.get('running') and status.get('visible'):break
                if attempt==3 and not preserve_native:
                    with device(args.tv,args.model) as connection:connection.launch(APP_ID)
                time.sleep(.5)
            closed_file.write_text(json.dumps({'model':args.model,'host':args.tv,'visible':status.get('visible',False),'running':status.get('running',False),'nativeHandoffPreserved':bool(preserve_native),'rootUsed':False})+'\n')


if __name__=='__main__':main()
