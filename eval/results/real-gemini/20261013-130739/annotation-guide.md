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

