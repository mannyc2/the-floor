"""Narrow Codama output to the two construction instructions without generic casts.

Codama generates the binary codecs; the pinned Anchor IDL supplies account order,
roles and discriminators. Explicit addresses keep signing out of construction.
"""
from pathlib import Path
import json,re,shutil

base=Path(__file__).parent
source=base/'client/src/generated/types'
target=base/'bounded-generated'
target.mkdir(exist_ok=True)
idl=json.loads((base/'idl.json').read_text())
exports={}
for path in source.glob('*.ts'):
    for name in re.findall(r'export (?:type|function|const) (\w+)',path.read_text()):
        exports[name]=path
pending=[source/'configParameters.ts',source/'initializePoolParameters.ts'];selected=set()
while pending:
    path=pending.pop()
    if path in selected:continue
    selected.add(path);text=path.read_text()
    if re.search(r'\bas\s+(?:const|[A-Z])|\bany\b|!\s*[;,.\[]',text):
        raise RuntimeError('Unexpected cast/assertion in binary codec '+str(path))
    for block in re.findall(r'import\s*\{([^}]+)\}\s*from\s*"\."',text,re.S):
        for name in block.split(','):
            name=name.strip().removeprefix('type ')
            if name:pending.append(exports[name])
for path in sorted(selected):
    text=path.read_text()
    def direct_import(match):
        grouped={}
        for raw in match.group(1).split(','):
            raw=raw.strip()
            if not raw:continue
            name=raw.removeprefix('type ')
            grouped.setdefault(exports[name].stem,[]).append(raw)
        return '\n'.join('import { '+', '.join(names)+' } from "./'+stem+'";' for stem,names in sorted(grouped.items()))
    text=re.sub(r'import\s*\{([^}]+)\}\s*from\s*"\.";',direct_import,text,flags=re.S)
    (target/path.name).write_text(text)
(target/'index.ts').write_text(''.join('export * from "./'+p.stem+'";\n' for p in sorted(selected)))

def camel(value):
    first,*rest=value.split('_');return first+''.join(p.title() for p in rest)
def pascal(value):
    value=camel(value);return value[0].upper()+value[1:]

text='''// Generated from the pinned IDL and Codama binary codecs; regenerate, do not hand-edit.
import { AccountRole, address, fixEncoderSize, getBytesEncoder, getStructEncoder, transformEncoder } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getConfigParametersEncoder, getInitializePoolParametersEncoder } from "./bounded-generated";
import type { ConfigParametersArgs, InitializePoolParametersArgs } from "./bounded-generated";
export const programAddress = address("'''+idl['address']+'''");
'''
for instruction in idl['instructions']:
    if instruction['name'] not in ['create_config','initialize_virtual_pool_with_spl_token']:continue
    name=pascal(instruction['name']);argument=instruction['args'][0];arg_name=camel(argument['name']);arg_type=argument['type']['defined']['name']
    text+='\nexport interface '+name+'Accounts {\n'
    for account in instruction['accounts']:
        if 'address' not in account and account['name']!='program':text+='  readonly '+camel(account['name'])+': Address;\n'
    text+='}\n'
    text+='const '+camel(instruction['name'])+'Data = transformEncoder(getStructEncoder([\n'
    text+='  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],\n  ["'+arg_name+'", get'+arg_type+'Encoder()],\n]), (value: { readonly '+arg_name+': '+arg_type+'Args }) => ({ ...value, discriminator: new Uint8Array('+json.dumps(instruction['discriminator'])+') }));\n'
    text+='export function get'+name+'Instruction(accounts: '+name+'Accounts, '+arg_name+': '+arg_type+'Args): Instruction {\n  return {\n    programAddress,\n    accounts: [\n'
    for account in instruction['accounts']:
        role=('WRITABLE' if account.get('writable') else 'READONLY')+('_SIGNER' if account.get('signer') else '')
        value='address("'+account['address']+'")' if 'address' in account else 'programAddress' if account['name']=='program' else 'accounts.'+camel(account['name'])
        text+='      { address: '+value+', role: AccountRole.'+role+' },\n'
    text+='    ],\n    data: '+camel(instruction['name'])+'Data.encode({ '+arg_name+' }),\n  };\n}\n'
(base/'bounded-instructions.ts').write_text(text)
print('Generated two unsigned instruction builders and',len(selected),'Codama codec modules; no casts or any.')
