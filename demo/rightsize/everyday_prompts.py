"""Writes data/everyday.jsonl: a curated set of everyday assistant requests.

Hand-written to cover what people actually ask a chat assistant day to day, from
"what should I eat" to debugging code. Categories are for analysis only; routers
must never see them. Edit freely, then re-run:  python everyday_prompts.py
"""
import json
from pathlib import Path

D1_NOTES = """Mon sync 10/6
- Launch date for v2 still Nov 3, Priya worried QA won't finish in time
- Sam: payment bug fixed, needs review by Thursday
- Agreed to cut dark mode from v2
- Lena drafts the launch email, due 10/15
- Ads budget approved, $8k
- Next sync moved to Wednesday"""

D2_BULLETS = """- finished API migration (3 days late)
- onboarding flow tests at 80% coverage
- blocked on design for the settings page
- next week: start billing page, fix 2 bugs from support"""

D7_COMPLAINT = """I ordered a blender on Sept 28 and it arrived with a cracked jar. I emailed twice and nobody answered. I want a replacement shipped this week or a full refund, and honestly I'm thinking of leaving a review about how bad this has been."""

W4_PARAGRAPH = """In today's fast-paced world, it is very important for businesses of all sizes to make sure that they are taking the necessary steps in order to ensure that their customer service is meeting the needs and expectations of the customers that they serve, because if they do not do this, then customers may choose to go elsewhere."""

W9_NOTES = """- bakery sale raised $1,240 for the food bank
- 14 volunteers, thanks to Maria for organizing
- most popular item: cinnamon rolls, sold out by 11am
- next sale planned for March"""

K2 = """Why does this give an error?

nums = [1, 2, 3]
for i in range(len(nums) + 1):
    print(nums[i])"""

K5 = """My React component re-renders forever. What's wrong?

function Profile({ id }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch(`/api/users/${id}`).then(r => r.json()).then(setUser);
  });
  return <div>{user?.name}</div>;
}"""

K9 = """This Python function is slow on lists of 100,000 items. Make it faster and explain why.

def dedupe(items):
    out = []
    for x in items:
        if x not in out:
            out.append(x)
    return out"""

K12 = """Find the bug: this binary search sometimes loops forever.

def search(a, t):
    lo, hi = 0, len(a) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < t:
            lo = mid
        else:
            hi = mid
    return lo if a[lo] == t else -1"""

K14 = """Convert this callback code to async/await:

fs.readFile('a.txt', 'utf8', (err, a) => {
  if (err) return cb(err);
  fs.readFile('b.txt', 'utf8', (err, b) => {
    if (err) return cb(err);
    cb(null, a + b);
  });
});"""

PROMPTS = {
    "food": [
        "what should i make for dinner tonight, i have chicken thighs, rice, a can of coconut milk and some spinach",
        "Give me 5 quick breakfast ideas that aren't eggs",
        "can I use baking soda instead of baking powder in pancakes",
        "Healthy snack ideas for an afternoon at work, nothing that needs a fridge",
        "I'm vegetarian and want more protein. Suggest a week of simple lunches.",
        "How long do I boil an egg for a jammy yolk?",
        "Suggest something to eat. I'm tired and don't want to cook.",
        "What wine goes with mushroom risotto?",
        "Scale this recipe from 4 servings to 6: 200g pasta, 2 tbsp olive oil, 3 cloves garlic, 1 can tomatoes, 50g parmesan",
        "My bread came out dense and didn't rise much. What usually causes that?",
    ],
    "messages": [
        "Write a happy birthday text for my sister, short and a little funny",
        "Help me reply to my landlord saying I'll pay rent 3 days late this month, polite but not groveling",
        "Write a thank you note to my coworker who covered my shift last weekend",
        "how do i say no to a wedding invitation nicely, we can't afford the trip",
        "Make this sound more professional: hey can we push the meeting to thurs, something came up",
        "Write a LinkedIn message congratulating a former manager on her new job",
        "Text to my friend apologizing for missing her party last night",
        "Write a short out-of-office reply. I'm back on Monday the 19th; contact Priya for anything urgent.",
        "Give me 3 ways to start a conversation on a dating app with someone who likes rock climbing",
        "Write a sympathy card message for a colleague whose father passed away",
    ],
    "quick_facts": [
        "What's the capital of Australia?",
        "Who wrote Pride and Prejudice?",
        "Why is the sky blue? one sentence",
        "What's the difference between a crocodile and an alligator?",
        "How many players are on a soccer team?",
        "What does 'per se' mean?",
        "Is a tomato a fruit or a vegetable?",
        "What year did the Berlin Wall fall?",
        "What's the tallest mountain in Africa?",
        "What does HTTP stand for?",
    ],
    "conversions": [
        "convert 350 F to celsius",
        "How many ml in 3/4 cup?",
        "If it's 3pm in New York what time is it in London?",
        "What's an 18% tip on $64.50?",
        "5 miles in km",
        "How many weeks until December 25 if today is October 10?",
        "Convert 72 kg to pounds",
        "What's 15% off $120?",
    ],
    "shopping_gifts": [
        "Gift ideas for my dad who likes gardening and history, under $50",
        "What should I look for when buying a used bike?",
        "Is it worth buying an air fryer for a single person?",
        "Secret Santa gift ideas under $20 for someone I barely know",
        "What's the practical difference between 16GB and 32GB of RAM for everyday laptop use?",
        "Housewarming gift ideas that aren't candles",
        "What size TV should I get for a couch 9 feet away?",
        "Give me a checklist for buying my first car from a private seller",
    ],
    "travel": [
        "Plan a relaxed 2-day trip to Philadelphia for a couple who likes food and history",
        "Packing list for a 5 day beach trip",
        "Tips for a long-haul flight with a toddler",
        "What should I know before visiting Tokyo for the first time?",
        "Cheap weekend getaway ideas from New York without a car",
        "Is it better to exchange money before traveling to Europe or use ATMs there?",
        "Give me a rainy day itinerary for London",
        "How early should I get to the airport for an international flight?",
    ],
    "home_life": [
        "How do I get a red wine stain out of a carpet?",
        "My monstera has yellow leaves, what am I doing wrong?",
        "Make me a simple weekly cleaning schedule for a 1-bedroom apartment",
        "How often should I wash my bed sheets?",
        "Easy ways to make a small apartment feel bigger",
        "My dog barks at the door every time someone walks by. How do I train him to stop?",
        "Give me a 15 minute stretching routine for after sitting all day",
        "How do I unclog a bathroom sink without chemicals?",
    ],
    "fun": [
        "Tell me a joke about programmers",
        "Name ideas for a grey kitten",
        "Give me 10 trivia questions about the 90s with answers",
        "Write a limerick about a cat who hates Mondays",
        "Suggest a board game for 4 adults who like strategy but not too long",
        "Recommend 3 movies like Interstellar",
        "Fun team-building activities for a remote team of 8",
        "Write a short bedtime story about a dragon who is afraid of the dark, for a 5 year old",
    ],
    "explain_simple": [
        "Explain how vaccines work like I'm 10",
        "What is inflation, in simple terms?",
        "What's the difference between a Roth IRA and a traditional IRA?",
        "Explain what a VPN does",
        "Why do we have leap years?",
        "What does an API do? Explain without jargon",
        "How does a credit score work?",
        "Explain the offside rule in soccer",
        "What's the difference between weather and climate?",
        "How do noise-cancelling headphones work?",
    ],
    "writing": [
        "Write a cover letter for a junior data analyst role at a healthcare company. I have a statistics degree and one internship building Excel dashboards.",
        "Write a 300-word blog intro about why people should start journaling",
        "Give me an outline for a 10-minute best man speech. The groom is my brother; we grew up fishing together.",
        "Rewrite this paragraph to be clearer and shorter:\n\n" + W4_PARAGRAPH,
        "Write a product description for handmade ceramic mugs for my Etsy shop",
        "Write a 200-word story opening about a lighthouse keeper who finds a message in a bottle",
        "Write a persuasive email to my HOA asking them to allow vegetable gardens in front yards",
        "Draft a one-page personal statement for a nursing school application. I worked as a CNA for 3 years.",
        "Turn these notes into a polished paragraph for our team newsletter:\n\n" + W9_NOTES,
        "Write 5 Instagram captions for photos of my bakery's new croissants",
    ],
    "work_docs": [
        "Summarize these meeting notes into decisions and action items with owners:\n\n" + D1_NOTES,
        "Write a short weekly status update for my manager from these bullets:\n\n" + D2_BULLETS,
        "Turn this into a table with columns Task, Owner, Due date: Jake books the venue by Friday, Mia sends invites next Tuesday, catering quotes from Omar by the 20th, and I'll handle the playlist sometime next week.",
        "Write an agenda for a 30-minute kickoff meeting for a website redesign project",
        "Draft a polite email declining a vendor's proposal because it's over our budget",
        "Write a job description for a part-time barista",
        "Summarize this customer complaint and draft a reply from our support team:\n\n" + D7_COMPLAINT,
        "Create an onboarding checklist for a new remote employee's first week",
    ],
    "money": [
        "I make $4,200 a month after tax. Help me make a budget using the 50/30/20 rule.",
        "If I put $200 a month into savings at 4% annual interest compounded monthly, how much will I have after 5 years?",
        "Should I pay off my credit card at 24% APR or put extra money in my 401k with a 50% match up to 6%?",
        "Split a dinner bill: Alex's food was $52, Sam's $38, Jo's $61, and we shared a $35 appetizer equally. Add 20% tip on everything. What does each person pay?",
        "Is it better to lease or buy a car if I drive 8,000 miles a year and keep cars about 8 years?",
        "Calculate the monthly payment on a $25,000 car loan at 6.9% APR for 60 months",
        "How much should I have in an emergency fund?",
        "Rent is $2,400 and I split it with a roommate. My room is 140 sq ft and theirs is 200 sq ft, and we share everything else. What's a fair split?",
    ],
    "math": [
        "A train leaves at 2:15pm going 60 mph. A second train leaves the same station at 3:00pm going 80 mph on the same track. When does the second train catch up?",
        "What's the probability of getting at least one six in four rolls of a fair die?",
        "Solve for x: 3(x - 4) + 2 = 5x - 14",
        "A rectangle's length is 3 more than twice its width. Its perimeter is 54. Find its area.",
        "In a class of 30, 18 play soccer, 12 play basketball and 5 play both. How many play neither?",
        "I flip a fair coin 10 times. What's the probability of exactly 6 heads?",
        "Find all pairs of positive integers x, y with x^2 - y^2 = 45.",
        "A store marks an item up 40% and then offers 25% off the marked price. What's the net change from the original price?",
        "How many ways can 5 people sit around a round table if two of them refuse to sit next to each other?",
        "Prove that the sum of the first n odd numbers is n^2.",
        "Pipe A fills a tank in 6 hours and pipe B in 9 hours. Pipe C drains it in 12 hours. With all three open, how long does it take to fill?",
        "What is the expected number of rolls of a fair die until every face has appeared at least once?",
    ],
    "coding": [
        "Write a Python function that checks whether a string is a valid IPv4 address, without using regex or the ipaddress module.",
        K2,
        "Write a SQL query that returns the top 3 customers by total order value in 2025, given tables customers(id, name) and orders(id, customer_id, amount, created_at).",
        "Write a regex that matches US phone numbers like (212) 555-0199, 212-555-0199 and 2125550199.",
        K5,
        "Implement an LRU cache in Python with O(1) get and put, without using functools.",
        "Write a bash one-liner that lists the 10 largest files under the current directory, including subfolders.",
        "Explain the difference between a process and a thread, and when to use asyncio vs multiprocessing in Python.",
        K9,
        "Write a function that merges overlapping intervals, e.g. [[1,3],[2,6],[8,10]] -> [[1,6],[8,10]]. Include tests.",
        "Design a rate limiter that allows 100 requests per minute per user. Give Python code and explain token bucket vs sliding window.",
        K12,
        "Write a Dockerfile for a FastAPI app with a requirements.txt, running as a non-root user.",
        K14,
    ],
    "reasoning_planning": [
        "Schedule these meetings in one 9am-1pm block with no overlaps: Ana (1 hr, must end by 11), Ben (30 min, only after 10:30), Chloe (90 min), Dev (30 min, not right before or after Chloe). Show the schedule.",
        "Three boxes are labeled apples, oranges and mixed, and every label is wrong. You may take one fruit from one box without looking inside. How do you relabel all the boxes correctly?",
        "I have two job offers: A pays $95k fully remote; B pays $112k, hybrid 3 days a week, with a 50-minute commute each way. Help me compare them, including the value of my time.",
        "We're 4 roommates with 6 chores a week. Make a fair 4-week rotation so nobody does the same chore two weeks in a row.",
        "If all bloops are razzies and some razzies are lazzies, does it follow that some bloops are lazzies? Explain.",
        "Plan a 12-week training schedule to go from running 5k to a half marathon, 4 runs per week.",
        "I'm moving from Boston to Austin in 6 weeks with a cat and a 1-bedroom apartment's worth of stuff. Give me a week-by-week plan.",
        "A farmer must cross a river with a wolf, a goat and a cabbage. The boat holds the farmer and one item. How does he get everything across safely?",
        "Our startup's monthly churn went from 3% to 5% after a price increase. List hypotheses and the data we'd check for each.",
        "Five friends ran a race. Kim beat Lee. Max finished right after Ned. Lee wasn't first. Ned beat Kim. Oz finished right before Lee. What was the finishing order?",
    ],
}


def main() -> None:
    out = Path("data/everyday.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with out.open("w") as f:
        for category, prompts in PROMPTS.items():
            for i, prompt in enumerate(prompts):
                row = {"id": f"everyday-{category}-{i:02d}", "category": category, "source": "curated", "prompt": prompt}
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                n += 1
    print(f"wrote {n} prompts in {len(PROMPTS)} categories to {out}")


if __name__ == "__main__":
    main()
