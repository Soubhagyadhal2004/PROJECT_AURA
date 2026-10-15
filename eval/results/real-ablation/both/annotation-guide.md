# Checking the automatic labels by hand

Open annotation.csv. For each row, read the memory, look up that persona below, and write one label in human_label (without looking at auto_label first if you can). Ideally a second person labels a copy independently.

| label | use when the memory... |
|---|---|
| true | states something that is true about the user at the end |
| ended | correctly says that a fact the user retired is over ("finished the Lotus project") |
| stale | states something the user said earlier that is no longer true, or something the user asked to forget |
| false | states something the user never said about themselves (misread, invented) |
| hypothetical | keeps a hypothetical or a maybe as a memory ("if the user had a cat...") |
| third-party | is a fact about someone else the user mentioned (allowed) |
| other | none of the above (write why in notes) |

## Persona 1-0

Session 1: "My main hobby is chess." "I'm learning German." "I'm eggetarian." "I take my coffee black."
Session 2: "My dog is called Tiger." "I live in Kolkata." "Is it true that octopuses have three hearts?" "Like I said, my main hobby is chess." "I go to the gym at 6 am every day." "My sister's name is Priya."
Session 3: "If I ever moved to Goa, I'd spend every evening on the beach." "Correction, my dog's name is actually Mithu." "These days I take my coffee with extra sugar." "Like I said, my main hobby is chess."
Session 4: "I moved my gym time to 7 am." "If I had a cat I would call her Luna." "Please forget what I told you about my sister."
Session 5: "Like I said, i live in Kolkata." "My new main hobby is cycling." "I stopped going to the gym." "What's the weather like in Shimla today?"

Truth at the end: hobby: cycling; language: German; diet: eggetarian; coffee: with extra sugar; pet: Mithu; city: Kolkata; gym: no longer true; sister: no longer true. Asked to forget: sister (Priya).

## Persona 1-1

Session 1: "I go to the gym at 7 am every day." "My birthday is on 21 September." "I take my coffee as a cappuccino." "My dog is called Mithu."
Session 2: "Like I said, my dog is called Mithu." "My friend Rohan just bought a Thar, it looks great." "I live in Kolkata." "I drive a Seltos." "I work at Swiggy." "I'm leading a project called Lotus at work."
Session 3: "Like I said, i go to the gym at 7 am every day." "What's the weather like in Shimla today?" "I moved my gym time to 6 pm." "My project wrapped up last week, I'm between projects."
Session 4: "Like I said, i work at Swiggy." "Please forget what I told you about my birthday." "Can you set a timer for ten minutes?" "I've just moved to Pune."
Session 5: "Is it true that octopuses have three hearts?" "Like I said, i work at Swiggy." "I've just moved to Chennai." "I sold my old car and bought a Swift."

Truth at the end: gym: 6 pm; birthday: no longer true; coffee: as a cappuccino; pet: Mithu; city: Chennai; car: Swift; employer: Swiggy; project: no longer true. Asked to forget: birthday (21 September).

## Persona 1-2

Session 1: "I'm leading a project called Falcon at work." "I take my coffee with oat milk." "I work at Wipro." "My main hobby is guitar."
Session 2: "I'm learning Spanish." "My cousin works at Google in Zurich." "I go to the gym at 8 pm every day." "Like I said, i work at Wipro." "My sister's name is Sneha." "I live in Bhubaneswar."
Session 3: "These days I take my coffee black." "Like I said, my sister's name is Sneha." "Please forget what I told you about where I live." "Can you set a timer for ten minutes?"
Session 4: "If I had a cat I would call her Luna." "My new main hobby is chess." "I stopped going to the gym."
Session 5: "Is it true that octopuses have three hearts?" "I go to the gym at 7 am every day." "I dropped that and started learning Korean instead."

Truth at the end: project: Falcon; coffee: black; employer: Wipro; hobby: chess; language: Korean; gym: 7 am; sister: Sneha; city: no longer true. Asked to forget: city (Bhubaneswar).

## Persona 1-3

Session 1: "I take my coffee with oat milk." "I go to the gym at 6 pm every day." "My main hobby is guitar." "I work at Flipkart."
Session 2: "If I had a cat I would call her Luna." "I'm leading a project called Nimbus at work." "My birthday is on 8 December." "My sister's name is Priya." "Like I said, i work at Flipkart." "I'm learning Korean."
Session 3: "These days I take my coffee with extra sugar." "Like I said, i go to the gym at 6 pm every day." "Please forget what I told you about my birthday." "Can you set a timer for ten minutes?"
Session 4: "Like I said, my sister's name is Priya." "These days I take my coffee as a cappuccino." "If I ever moved to Goa, I'd spend every evening on the beach." "I dropped that and started learning Japanese instead."
Session 5: "Like I said, i'm leading a project called Nimbus at work." "My friend Rohan just bought a Thar, it looks great." "My project wrapped up last week, I'm between projects." "These days I take my coffee black."

Truth at the end: coffee: black; gym: 6 pm; hobby: guitar; employer: Flipkart; project: no longer true; birthday: no longer true; sister: Priya; language: Japanese. Asked to forget: birthday (8 December).

## Persona 1-4

Session 1: "My main hobby is cycling." "I'm leading a project called Orion at work." "My birthday is on 21 September." "I'm eggetarian."
Session 2: "I drive a Nexon." "I take my coffee as a cappuccino." "Like I said, i'm leading a project called Orion at work." "My dog is called Simba." "I work at Freshworks." "My cousin works at Google in Zurich."
Session 3: "I sold my old car and bought a Baleno." (AURA: "Since you enjoy languages, you could try Italian next.") "Hmm, maybe, I'll think about it." "Like I said, my main hobby is cycling." "My new main hobby is painting."
Session 4: "Please forget what I told you about my hobby." "Is it true that octopuses have three hearts?" "Like I said, i work at Freshworks." "I sold my old car and bought a Swift."
Session 5: "Please forget what I told you about my birthday." "I've left my job and I'm not working right now." "Like I said, my dog is called Simba." "If I had a cat I would call her Luna."

Truth at the end: hobby: no longer true; project: Orion; birthday: no longer true; diet: eggetarian; car: Swift; coffee: as a cappuccino; pet: Simba; employer: no longer true. Asked to forget: hobby (painting), birthday (21 September).

## Persona 1-5

Session 1: "I take my coffee with extra sugar." "I'm vegetarian." "I'm leading a project called Atlas at work." "I go to the gym at 6 am every day."
Session 2: "My sister's name is Ritu." "I'm learning French." "I work at Razorpay." "I drive a Baleno." "Is it true that octopuses have three hearts?" "Like I said, i go to the gym at 6 am every day."
Session 3: "Please forget what I told you about my sister." "Like I said, i'm learning French." "If I ever moved to Goa, I'd spend every evening on the beach." "I've been moved to a new project called Falcon."
Session 4: "I quit my old job and joined Swiggy." "Like I said, i'm vegetarian." "Please forget what I told you about my diet." "If I had a cat I would call her Luna."
Session 5: "What's the weather like in Shimla today?" "These days I take my coffee black." "Like I said, i work at Swiggy." "I've been moved to a new project called Lotus."

Truth at the end: coffee: black; diet: no longer true; project: Lotus; gym: 6 am; sister: no longer true; language: French; employer: Swiggy; car: Baleno. Asked to forget: sister (Ritu), diet (vegetarian).

## Persona 1-6

Session 1: "I work at Freshworks." "I'm learning Japanese." "I live in Lucknow." "My main hobby is chess."
Session 2: "I go to the gym at 6 am every day." "Like I said, i live in Lucknow." (AURA: "Since you enjoy languages, you could try Italian next.") "Hmm, maybe, I'll think about it." "My dog is called Bruno." "I drive a Swift." "I'm leading a project called Falcon at work."
Session 3: "My friend Rohan just bought a Thar, it looks great." "Please forget what I told you about my job." "I moved my gym time to 7 am."
Session 4: "Correction, my dog's name is actually Mithu." "My new main hobby is badminton." "If I ever moved to Goa, I'd spend every evening on the beach."
Session 5: "I dropped that and started learning Spanish instead." "Like I said, i'm leading a project called Falcon at work." "My cousin works at Google in Zurich." "I've been moved to a new project called Lotus."

Truth at the end: employer: no longer true; language: Spanish; city: Lucknow; hobby: badminton; gym: 7 am; pet: Mithu; car: Swift; project: Lotus. Asked to forget: employer (Freshworks).

## Persona 1-7

Session 1: "My birthday is on 21 September." "I'm leading a project called Nimbus at work." "I work at Swiggy." "My main hobby is cycling."
Session 2: "Like I said, my main hobby is cycling." "I'm eggetarian." "I go to the gym at 7 am every day." "My sister's name is Ananya." "If I ever moved to Goa, I'd spend every evening on the beach." "I'm learning Japanese."
Session 3: "Can you set a timer for ten minutes?" "Please forget what I told you about my sister." "Please forget what I told you about my hobby." "Like I said, i go to the gym at 7 am every day."
Session 4: "My sister's name is Priya." "If I had a cat I would call her Luna." "Like I said, i go to the gym at 7 am every day." "I stopped going to the gym."
Session 5: "Is it true that octopuses have three hearts?" "I've been moved to a new project called Lotus." "I quit my old job and joined Infosys."

Truth at the end: birthday: 21 September; project: Lotus; employer: Infosys; hobby: no longer true; diet: eggetarian; gym: no longer true; sister: Priya; language: Japanese. Asked to forget: sister (Ananya), hobby (cycling).

## Persona 1-8

Session 1: "I'm eggetarian." "My main hobby is painting." "My birthday is on 21 September." "I go to the gym at 6 am every day."
Session 2: "I live in Jaipur." "Like I said, i go to the gym at 6 am every day." "If I had a cat I would call her Luna." "I work at Zoho." "My dog is called Coco." "I'm leading a project called Atlas at work."
Session 3: "Please forget what I told you about my birthday." "Is it true that octopuses have three hearts?" "I've been moved to a new project called Nimbus."
Session 4: "I've just moved to Bhubaneswar." "My birthday is on 3 July." "Can you set a timer for ten minutes?" "Like I said, my dog is called Coco."
Session 5: "Sadly my dog passed away last month." "Please forget what I told you about where I live." "Like I said, i'm eggetarian." "What's the weather like in Shimla today?"

Truth at the end: diet: eggetarian; hobby: painting; birthday: 3 July; gym: 6 am; city: no longer true; employer: Zoho; pet: no longer true; project: Nimbus. Asked to forget: birthday (21 September), city (Bhubaneswar).

## Persona 1-9

Session 1: "I live in Indore." "I work at Infosys." "My birthday is on 8 December." "I go to the gym at 8 pm every day."
Session 2: "My main hobby is cycling." "I'm leading a project called Nimbus at work." "Like I said, i work at Infosys." "I take my coffee black." "If I ever moved to Goa, I'd spend every evening on the beach." "I'm learning Japanese."
Session 3: "Is it true that octopuses have three hearts?" "I've quit coffee completely." "My new main hobby is badminton." "Like I said, my birthday is on 8 December."
Session 4: "Please forget what I told you about where I live." "Please forget what I told you about my hobby." "If I had a cat I would call her Luna."
Session 5: "I've been moved to a new project called Orion." "My cousin works at Google in Zurich." "I moved my gym time to 6 pm."

Truth at the end: city: no longer true; employer: Infosys; birthday: 8 December; gym: 6 pm; hobby: no longer true; project: Orion; coffee: no longer true; language: Japanese. Asked to forget: city (Indore), hobby (badminton).

## Persona 1-10

Session 1: "My sister's name is Ritu." "I'm eggetarian." "I take my coffee with oat milk." "My birthday is on 8 December."
Session 2: "I go to the gym at 6 pm every day." (AURA: "Since you enjoy languages, you could try Italian next.") "Hmm, maybe, I'll think about it." "Like I said, i'm eggetarian." "My main hobby is chess." "I drive a Seltos." "I'm leading a project called Falcon at work."
Session 3: "Please forget what I told you about my hobby." "My cousin works at Google in Zurich." "I've changed my diet, I'm pescatarian now." "Like I said, i go to the gym at 6 pm every day."
Session 4: "I've changed my diet, I'm vegan now." "I moved my gym time to 8 pm." "Is it true that octopuses have three hearts?"
Session 5: "What's the weather like in Shimla today?" "My main hobby is cycling." "Please forget what I told you about my sister."

Truth at the end: sister: no longer true; diet: vegan; coffee: with oat milk; birthday: 8 December; gym: 8 pm; hobby: cycling; car: Seltos; project: Falcon. Asked to forget: hobby (chess), sister (Ritu).

## Persona 1-11

Session 1: "I work at Infosys." "I live in Hyderabad." "My main hobby is painting." "I go to the gym at 6 am every day."
Session 2: "I drive a Creta." "My birthday is on 12 March." "Is it true that octopuses have three hearts?" "Like I said, my main hobby is painting." "I'm vegan." "My sister's name is Kavya."
Session 3: "I stopped going to the gym." "My cousin works at Google in Zurich." "I sold my old car and bought a Swift."
Session 4: "If I ever moved to Goa, I'd spend every evening on the beach." "I've just moved to Pune." "I sold my old car and bought a Seltos."
Session 5: "Please forget what I told you about my sister." "If I had a cat I would call her Luna." "I quit my old job and joined Swiggy."

Truth at the end: employer: Swiggy; city: Pune; hobby: painting; gym: no longer true; car: Seltos; birthday: 12 March; diet: vegan; sister: no longer true. Asked to forget: sister (Kavya).

