import asyncio
import httpx

async def test():
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get("http://localhost:8000/api/binance/ticker24")
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"Total symbols: {len(data)}")
                usdt_pairs = [t for t in data if t['symbol'].endswith('USDT')]
                print(f"USDT pairs: {len(usdt_pairs)}")
                high_movers = [t for t in usdt_pairs if abs(float(t['priceChangePercent'])) >= 5]
                print(f"Movers >= 5%: {len(high_movers)}")
                movers_to_show = 0
                for t in high_movers:
                    if movers_to_show >= 5:
                        break
                    print(f"  {t['symbol']}: {t['priceChangePercent']}%")
                    movers_to_show += 1
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test())
