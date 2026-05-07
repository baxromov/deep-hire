Problem 1: Vacancy yuklanganda HH resume search ko‘p marta chaqiriladi
Natija: qisqa vaqtda juda ko‘p request → 429 Too Many Requests
✅ Solution

Vacancy → darhol search QILMASLIK
Avval “light check” qilish:

per_page=1 bilan faqat found sonini olish


found > 0 bo‘lsa, keyin cheklangan page bilan davom etish


Problem 2: Bir vaqtda juda ko‘p parallel request ketayapti
Natija: HH buni bot/scraping deb qabul qiladi → 429
✅ Solution

Global rate limiter joriy qilish
Butun platforma bo‘yicha:

max 2–3 ta parallel request
requestlar orasida 300–500 ms delay


Har recruiter uchun emas, butun sistemaga bitta queue


Problem 3: Bir xil filterlar bilan HH’ga qayta-qayta chiqyapsiz
Natija: keraksiz requestlar → limit tez to‘ladi
✅ Solution

Resume search natijalarini cache qilish
Cache key:
text + area + experience + employment


TTL:

30–60 minut (hatto 2 soat ham bo‘ladi)


Natija:

10 ta bir xil vacancy → 1 ta HH request




Problem 4: Har vacancy uchun alohida resume search qilinyapti
Natija: request soni geometrik oshadi
✅ Solution

Batch approach
O‘xshash vacancy’larni guruhlab:

bitta umumiy resume search
ichkarida matching


Masalan:

10 ta Java vacancy → 1 ta resume search




Problem 5: 429 kelganda darrov retry qilinyapti
Natija: token/IP vaqtincha “qora ro‘yxat”ga tushadi
✅ Solution

Exponential backoff

Plain Text1-urinish→ 429→ kut 2s→ qayta urin→ yana 429→ kut 5s→ STOPПоказать больше строк

Hech qachon:

parallel retry
darhol qayta urinish QILMASLIK




Problem 6: Juda ko‘p page’lar yuklanyapti
Natija: /resumes eng “qimmat” endpoint → 429
✅ Solution

Page limit qo‘yish:

max 2–3 page
per_page=50


Amalda:

90% recruiterga 1–2 page yetarli




Problem 7: Har recruiter mustaqil ishlayapti
Natija: bitta faol recruiter butun sistemani yiqitadi
✅ Solution

Central queue + worker
Rekruterlar:

request yuboradi → queue’ga tushadi


Worker:

sekin, nazorat bilan HH’ga yuboradi




Qisqa xulosa (senior summary)
Agar sizda quyidagilar bo‘lsa:
✅ Global queue
✅ 2–3 parallel limit
✅ Delay
✅ Cache
✅ Page limit
✅ Batch processing
✅ To‘g‘ri retry
👉 429 deyarli 0 ga tushadi (real production tajriba).
