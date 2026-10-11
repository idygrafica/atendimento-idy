"""Teste offline: todas as respostas HTTP são interceptadas, sem acessar produção."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII='

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 390, 'height': 844})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        calls = {'chat': 0, 'manual': 0}
        chat_started, chat_release = asyncio.Event(), asyncio.Event()
        conversations = {
            '5551988887777': {'phone': '5551988887777', 'name': 'Cliente A', 'mode': 'ai', 'updatedAt': '2026-10-11T12:00:00Z', 'messages': [{'role': 'user', 'text': 'Briefing do cliente A', 'at': '2026-10-11T12:00:00Z'}]},
            '5551977776666': {'phone': '5551977776666', 'name': 'Cliente B', 'mode': 'ai', 'updatedAt': '2026-10-11T12:00:00Z', 'messages': [{'role': 'user', 'text': 'Briefing do cliente B', 'at': '2026-10-11T12:00:00Z'}]},
        }
        async def route_handler(route):
            request = route.request
            from urllib.parse import urlparse, parse_qs
            url = urlparse(request.url)
            if url.path in ['/', '/index.html', '/painel.html'] and request.method == 'GET':
                filename = 'painel.html' if url.path == '/painel.html' else 'index.html'
                await route.fulfill(status=200, content_type='text/html', body=(ROOT / filename).read_text())
                return
            status, result = 200, {}
            if url.path.endswith('/chat'):
                calls['chat'] += 1
                chat_started.set()
                await chat_release.wait()
                result = {'answer': '500 cartões padrão ficam R$ 85,00.'}
            elif url.path.endswith('/health'):
                result = {'status': 'netlify-function-ok', 'hasKey': True}
            elif url.path.endswith('/panel-api'):
                if request.method == 'GET':
                    phone = parse_qs(url.query).get('phone', [None])[0]
                    result = {'conversation': conversations.get(phone)} if phone else {'conversations': list(conversations.values())}
                else:
                    body = request.post_data_json
                    if body['action'] == 'send_message':
                        calls['manual'] += 1
                        conversations[body['phone']]['messages'].append({'role': 'human', 'text': body['text'], 'at': '2026-10-11T12:01:00Z'})
                        conversations[body['phone']]['mode'] = 'human'
                    else:
                        conversations[body['phone']]['mode'] = body['mode']
                    result = {'ok': True}
            elif url.path.endswith('/creative-preview'):
                result = {'ok': True, 'image': PNG, 'previewOnly': True}
            elif request.method == 'POST' and url.path == '/':
                await route.fulfill(status=200, body='registrado'); return
            elif url.path.endswith('/notify-idy-whatsapp'):
                status, result = 502, {'ok': False, 'error': 'Falha simulada'}
            else:
                await route.abort(); return
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(result))

        await page.route('**/*', route_handler)
        await page.goto('https://atendimento-idy.netlify.app/')
        await page.locator('#message').fill('Quero 500 cartões')
        await page.locator('#message').press('Enter')
        await asyncio.wait_for(chat_started.wait(), 5)
        await page.locator('#message').fill('Outra mensagem')
        await page.locator('#message').press('Enter')
        assert calls['chat'] == 1, 'Envio concorrente não bloqueado'
        chat_release.set()
        await page.get_by_text('500 cartões padrão ficam R$ 85,00.').wait_for()
        assert not await page.locator('#send').is_disabled()
        await page.locator('#health').click()
        await page.get_by_text('200 — netlify-function-ok').wait_for()
        await page.locator('#lead').click()
        await page.locator('#clientName').fill('Cliente Teste')
        await page.locator('#clientPhone').fill('5551988887777')
        await page.locator('#submitLead').click()
        await page.locator('#status').filter(has_text='O aviso por WhatsApp não foi confirmado').wait_for()
        assert await page.locator('#chat').get_by_text('Seu atendimento foi registrado para a IDY Gráfica.', exact=False).count() == 1
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Overflow horizontal no celular'

        await page.goto('https://atendimento-idy.netlify.app/painel.html')
        assert not await page.locator('#app').is_visible(), 'Painel não deve aparecer antes do login'
        await page.locator('#accessKey').fill('fake-panel-test')
        await page.locator('#loginBtn').click()
        await page.locator('#app').wait_for(state='visible')
        assert await page.evaluate("sessionStorage.getItem('idyPanelKey')") is None
        await page.locator('#convlist').get_by_text('Cliente A', exact=True).click()
        await page.locator('#messages').get_by_text('Briefing do cliente A', exact=True).wait_for()
        assert await page.locator('#brief').input_value() == 'Briefing do cliente A'
        await page.locator('#brief').fill('Rascunho próprio do cliente A')
        await page.locator('#convlist').get_by_text('Cliente B', exact=True).click()
        await page.locator('#messages').get_by_text('Briefing do cliente B', exact=True).wait_for()
        assert await page.locator('#brief').input_value() == 'Briefing do cliente B'
        await page.locator('#convlist').get_by_text('Cliente A', exact=True).click()
        await page.locator('#messages').get_by_text('Briefing do cliente A', exact=True).wait_for()
        assert await page.locator('#brief').input_value() == 'Rascunho próprio do cliente A'
        await page.locator('#generate').click()
        await page.locator('#preview img').wait_for()
        await page.locator('#manualText').fill('Vou continuar seu atendimento.')
        await page.locator('#sendManual').click()
        await page.locator('#messages').get_by_text('Vou continuar seu atendimento.', exact=True).wait_for()
        assert calls['manual'] == 1
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Overflow horizontal no painel mobile'
        await page.locator('#logoutBtn').click()
        assert not await page.locator('#app').is_visible()
        assert await page.locator('#login').is_visible()
        assert not errors, errors
        await browser.close()
        print('PASS: chat mobile, trava de envio, diagnóstico, registro com aviso falho, login, chave não persistida, briefings separados, prévia, resposta humana, logout e ausência de erros JS. HTTP totalmente simulado.')

asyncio.run(main())
