"""Block identifiable local configuration and private material in public sources."""
from pathlib import Path
import ipaddress,json,re
from public_files import ROOT,public_files

def check_privacy(root=ROOT):
    root=Path(root)
    configuration=root/'.local/developer-targets.json'
    config=json.loads(configuration.read_text()) if configuration.exists() else {}
    known={str(v.get('ip','')) for v in config.get('targets',{}).values()}
    known.update(config.get('allowedTvIps',[]));known.add(config.get('defaultTv',''))
    # Include a privately configured computer address when supplied locally.
    known.add(config.get('developmentComputer',''));known.discard('')
    problems=[];files=public_files(root)
    for file in files:
        data=file.read_bytes();relative=file.relative_to(root).as_posix()
        if str(Path.home()).encode()+b'/' in data:
            problems.append((relative,'personal home-directory path'))
        for address in known:
            if re.search(rb'(?<![\d.])'+re.escape(address.encode())+rb'(?![\d.])',data):
                problems.append((relative,'configured device/computer address'))
        if re.search(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----',data):
            problems.append((relative,'embedded private key'))
        if re.search(rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b',data):
            problems.append((relative,'embedded GitHub access token'))
        if file.suffix.lower() not in {'.md','.html','.yml','.yaml'}:
            continue
        text=data.decode('utf-8')
        if re.search(r'/Users/'+r'[A-Za-z0-9._-]+/',text) or 'file:///' in text:
            problems.append((relative,'local user/file URL'))
        if re.search(r'(?i)\b(?:[a-f0-9]{2}:){5}[a-f0-9]{2}\b',text):
            problems.append((relative,'MAC address'))
        if re.search(r'(?i)\b(?:serial(?:\s*number)?|duid)\b[^\n<>]{0,20}[:=]\s*["\x27]?[A-Za-z0-9+/=_-]{8,}',text):
            problems.append((relative,'serial number or DUID'))
        if re.search(r'\b(?:UA|QA|UN|UE)\d{2}[A-Z0-9]{6,}\b',text):
            problems.append((relative,'device-specific model reference'))
        for value in re.findall(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])',text):
            try:ip=ipaddress.ip_address(value)
            except ValueError:continue
            if ip.is_loopback or value.startswith(('192.0.2.','198.51.100.','203.0.113.')):
                continue
            if any(ip in ipaddress.ip_network(c) for c in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):
                problems.append((relative,'private network address in documentation'))
    if problems:
        raise RuntimeError('Public privacy check failed: '+json.dumps(sorted(set(problems))))
    return {'passed':True,'filesChecked':len(files),'privatePathsExported':False,
            'deviceIdentifiersInDocumentation':False}

if __name__=='__main__':
    print(json.dumps(check_privacy(),indent=2))
