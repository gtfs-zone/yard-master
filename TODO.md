- Assign a trip button: Lets go directly to the form modal and include the trip dropdown there
- Why do the inputs look different than the inputs in viz and edit? Why don't we have a calendar input like we do in viz and edit?
- Why are we using helper text instead of putting it in a tooltip like we usually do?
- Lets reorder the nav bar to match edit and viz
- Lets use the same calendar svg as edit and viz
- Lets state the currently logged in user instead of "Account"
- Lets make the feed page ACTUALLY look like edit and viz. Idk what happened in NEXT_PLAN2.md, but it still looks like a big clustery mess of random things and not like a nice clean transparent UI. If we can, we should add NO NEW custom UI components here and only reuse existing ones.
    - We don't have buttons to random pages in the other apps. We have lists of subitems that are clickable. Every once in a while we can have a link that isn't a direct child. That's ok, but it's an exception. Lets make the heierarchy clear first so we don't have issues like this
    - If something is truly independent and top level, we can put it in the nav
      bar. It can still have items that are geographically linked. Managers,
      for instance, should be in the top bar, as sharing with a sharing svg
    - Some things, we can simply remove. Why are we listing every stop here?
      Useless and ugly. We need to remove some of the pages too. For instance,
      a Service page has no use here, I think, unless we can come up with it in
      the heierarchy.
    - We are really just linking trackers with assignments, a lot of what we
      have added is useless information.
- When I say tooltip, I mean the viz/edit tooltip that always pops up.
- Lets default to Sunday as the first day because this is US centric (at some
  point we'll add some localization)

- Is there a way to handle the hell-gate trackers better? `Tracker columbia-county:SHOPPING_WK_758:20260821 is not in the loaded feed.`

In NEXT_PLAN:
- Lets change People -> Managers, call it add manager, move transfer ownership button to here
- Merge the two top level feed pages (it's confusing to have to click on the feed name to see different info)
- If we haven't imported the realtime spec the same way we've imported the scheduled spec, lets do the import
- Use the same input + spec tooltip style as before, and include dropdowns based on the scheduled feed
- Vendor shared about modal
