#!/usr/bin/env python3
import os, html
from datetime import datetime
import resend

resend.api_key = os.environ.get('RESEND_API_KEY', '')
output    = os.environ.get('AUDIT_OUTPUT', '')
status    = os.environ.get('AUDIT_STATUS', 'INCONNU')
exit_code = os.environ.get('AUDIT_EXIT', '1')

ok = exit_code == '0'
status_color = '#10D98F' if ok else '#FF3B30'
status_icon  = '✅' if ok else '\U0001f534'
date_str = datetime.now().strftime('%d/%m/%Y à %Hh%M')

lines = output.splitlines()
html_lines = []
for line in lines:
    esc = html.escape(line)
    if line.startswith('✅') or line.startswith('OK'):
        color = '#10D98F'
    elif line.startswith('❌') or 'erreur' in line.lower():
        color = '#FF3B30'
    elif line.startswith('⚠'):
        color = '#FFD60A'
    elif line.startswith('═'):
        color = 'rgba(255,255,255,0.3)'
    else:
        color = 'rgba(255,255,255,0.8)'
    html_lines.append(
        '<p style="margin:1px 0;font-size:12px;font-family:monospace;color:{}">{}</p>'.format(color, esc)
    )
html_body = ''.join(html_lines)

html_content = (
    '<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;'
    'background:#050E20;color:#fff;border-radius:12px;overflow:hidden">'
    '<div style="background:{};padding:16px 24px">'
    '<h2 style="margin:0;font-size:18px">{} Audit ALANE — {}</h2>'
    '<p style="margin:4px 0 0;opacity:0.85;font-size:13px">{} · Branche main</p>'
    '</div>'
    '<div style="padding:20px 24px;background:#0D1B3E">{}</div>'
    '<div style="padding:12px 24px;background:#050E20;font-size:11px;'
    'color:rgba(255,255,255,0.35)">Rapport généré automatiquement · alane.fr</div>'
    '</div>'
).format(status_color, status_icon, status, date_str, html_body)

api_key = resend.api_key
print('API key prefix: {}...'.format(api_key[:8] if api_key else 'VIDE'))
try:
    params = {
        'from': 'ALANE Audit <no-reply@alane.fr>',
        'to': ['direction@alane.fr'],
        'subject': '{} Audit ALANE — {} — {}'.format(status_icon, status, date_str),
        'html': html_content,
    }
    email = resend.Emails.send(params)
    print('Email envoye: {}'.format(email))
except Exception as e:
    print('Erreur envoi email: {}'.format(e))
    # Ne pas faire échouer le job — l'audit a réussi même si l'email échoue
