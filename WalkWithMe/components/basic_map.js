import React, { Component } from 'react';
import { bindAll, merge, isEmpty } from 'lodash';
import {
  AppRegistry, StyleSheet,
  Text, View, Navigator,
  Dimensions, TouchableOpacity,
  Button, Image, Alert,
  Modal, ActivityIndicator
} from 'react-native';
import { basicStyles, mapStyle } from './styles';

import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import RNGooglePlaces from 'react-native-google-places';
import Polyline from '@mapbox/polyline';
import { getDirections, getLocation, getFacebookPhoto } from './utils';
import * as firebase from 'firebase';
import CustomCallout from './CustomCallout';

const { width, height } = Dimensions.get('window');

const ASPECT_RATIO = width / height;
// const LATITUDE = 37.78825;
// const LONGITUDE = -122.4324;
const LATITUDE_DELTA = 0.006866;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;


class BasicMap extends React.Component {
 constructor(props) {
   super(props);

   this.state = {
     startPosition: {},
     markers: [],
     endPosition: {},
     polylineCoords: [],
     nearbyRoutes: {} ,
     selectRouteMarkers: [],
     selectRoutePolylineCoords: [],
     // haversineKey of selected route
     routeSelectedKey: '',
     // set when author sends match/follower receives match
     matchedRouteKey: '',
     // set when follower hits approve/author sees that event
     completedMatchKey: '',
     //set when route is saved to the database
     routeKey: '',
     // set by follower when match request received <- combine with match request?
     matchedRoute: false,
     // set by the author when a completed match has been seen
     // or the follower when hits approve - renders cancel button
     completedMatch: false,
     // set to show spinner on match sent
     spinner: false,
     // set for Author when match request sent
     matchRequest: false,
     // set when clicking on a marker
     routeSelected: false,
   };


   this.completedMatchesRef = firebase.database().ref('completedMatches');
   this.matchedRoutesRef = firebase.database().ref('matchedRoutes');
   this.routesRef = firebase.database().ref('routes');

   bindAll(this,
     'makeMarker', 'destinationButton', 'searchButtons',
     'matchButtons', 'renderButtons', 'haversine',
     'getRouteByStartAndHaversine', 'getRouteByChildValue',
     '_openSearchModal', '_createRouteCoordinates',
     '_saveRoute', '_showSelectedRoute', '_fitScreen',
     '_nearbyRoutesCallback', '_setListenersOnNewRoute',
     '_matchedRoutesCallback', '_sendMatchRequest',
     '_setListenersOnNewMatchRequest', '_completedMatchCallback',
     '_approveMatch', '_denyMatch',
     '_alertAuthorIncoming', 'insertModal', 'cancelMatchButtons',
     '_cancelRequest', '_authorCancelledCallback', 'updateFromChild',
     'renderCircle', '_turnOffListeners', '_showPotentialMatch',
     '_followerCancelledCallback'
   );
 }


 componentDidMount() {
   navigator.geolocation.getCurrentPosition(
     (position) => {
       const initialPosition = JSON.stringify(position);
       const {latitude, longitude} = position.coords;
       const LatLng = { latitude, longitude };
       this.makeMarker(LatLng, "startPosition", "Start Position");
     },
     (geoError) => alert(JSON.stringify(geoError)),
     {enableHighAccuracy: true, timeout: 20000, maximumAge: 1000}
   );
 }

componentDidUpdate() {
  // might need to also update the markers here if we move the start marker
  if (Object.keys(this.state.endPosition).length !== 0 &&
      Object.keys(this.state.startPosition).length !== 0) {
      if(this.state.completedMatch) {
        const newRegion = {
          latitude: this.state.startPosition.latitude,
          longitude: this.state.startPosition.longitude,
          latitudeDelta: LATITUDE_DELTA,
          longitudeDelta: LONGITUDE_DELTA
        };
        this.map.animateToRegion(newRegion);
      } else {
        this._fitScreen();
      }
  }
  // if(this.state.renderCircle && this.state.iterations < 21) {
  //   let deltaRad = 55.16 * this.state.iterations;
  //   let radius = 551.6 + deltaRad;
  //   let newIter = this.state.iterations += 1;
  //   // debugger
  //   console.log(newIter);
  //   this.setState({
  //     radius: radius,
  //     iterations: newIter
  //   });
  // }
}

_openSearchModal() {

  if(this.state.routeKey !== '') {
    firebase.database().ref('routes/' + this.state.routeKey).remove();
  }

  RNGooglePlaces.openAutocompleteModal()
  .then((place) => {
    const endpos = {
      latitude: place.latitude,
      longitude: place.longitude
    };
    this.makeMarker(endpos, "endPosition", "Destination");
    return place;
  }).then((place) => {
    const opts = {
      fromCoords: this.state.startPosition,
      toCoords: this.state.endPosition
    };
    getDirections(opts)
    .then(data => this._createRouteCoordinates(data))
    .then(polylineCoords => {
      this.setState({
        polylineCoords: polylineCoords,
        selectRouteMarkers: [],
        selectRoutePolylineCoords: [],
        matchedRouteKey: '',
        matchedRoute: false
      });
    });
  })
  .catch(error => console.log(error.message));
}


_createRouteCoordinates(data) {
   if (data.status !== 'OK') {
     console.log("Directions did not work");
     return [];
   }

   let points = data.routes[0].overview_polyline.points;
   let steps = Polyline.decode(points);
   let polylineCoords = [];

   for (let i=0; i < steps.length; i++) {
     let tempLocation = {
       latitude : steps[i][0],
       longitude : steps[i][1]
     };
     polylineCoords.push(tempLocation);
   }
   return polylineCoords;
 }

 _saveRoute(range){
   this._setListenersOnNewRoute(range);

   if(this.state.routeKey !== '') {
     firebase.database().ref('routes/' + this.state.routeKey).remove();
   }

   let newRouteRef = this.routesRef.push();
   let imgUrl;
   getFacebookPhoto({
     userID: this.props.user.userID,
     accessToken: this.props.user.accessToken}).then(
     (data) => {
       imgUrl = data.data.url;
       newRouteRef.set({
         userID: this.props.user.userID,
         name: this.props.user.name,
         startPosition: this.state.startPosition,
         endPosition: this.state.endPosition,
         routeKey: newRouteRef.key,
         routePoly: this.state.polylineCoords,
         imgUrl: imgUrl
       });
     }).then(
       () => {
         this.setState({
           routeKey: newRouteRef.key
         });
       }).then(() => {
         // potentially put check for no nearby routes here
     });
 }

 _setListenersOnNewRoute(range) {
   const startLat = this.state.startPosition.latitude - range;
   const endLat = this.state.startPosition.latitude + range;
   this.routesRef.orderByChild("startPosition/latitude")
   .startAt(startLat)
   .endAt(endLat)
   .on('child_added', this._nearbyRoutesCallback);
   this.routesRef.orderByChild("startPosition/latitude")
   .startAt(startLat)
   .endAt(endLat)
   .on('child_removed', this._nearbyRoutesCallback);
   this.matchedRoutesRef.orderByChild("follower/userID")
   .equalTo(this.props.user.userID)
   .on("child_added", this._matchedRoutesCallback);
 }

_nearbyRoutesCallback(data) {
    const newRoutes = Object.assign({}, this.state.nearbyRoutes);
    const dist = this.haversine(
      this.state.startPosition,
      data.val().startPosition
    );
    if( dist > 0 ) {
      const allHaversines = Object.keys(newRoutes).map(num => parseInt(num));
      if (allHaversines.length < 10 ) {
        newRoutes[dist] = data.val();
      } else {
        const max = Math.max(...allHaversines);
        if (max > dist) {
          delete newRoutes[max];
          newRoutes[dist] = data.val();
        }
      }
      this.setState({nearbyRoutes: newRoutes});
    }
}

_matchedRoutesCallback(data) {

  // set a listner for the author cancelling the match
  this.matchedRoutesRef.orderByChild("follower/userID")
  .equalTo(this.props.user.userID)
  .on("child_removed", this._authorCancelledCallback);

  const authorName = data.val().author.username;
  Alert.alert(
    'You have a Match!',
    `${authorName} would like to walk with you`,
    [
      {text: 'View Route', onPress: () => this._showPotentialMatch(data)},
    ]
  );
}

_authorCancelledCallback(data) {
  this._turnOffListeners();
  // reset pretty much everything except own route data
  this.setState({
    nearbyRoutes: {} ,
    selectRouteMarkers: [],
    selectRoutePolylineCoords: [],
    routeSelectedKey: '',
    matchedRouteKey: '',
    completedMatchKey: '',
    matchedRoute: false,
    completedMatch: false,
    spinner: false,
    matchRequest: false,
    routeSelected: false,
  });

  const authorName = data.val().author.username;
  const alertText = `${authorName} cancelled the match`;
  Alert.alert(
     alertText,
    'Would you like to make a new route or continue searching?',
    [
      {text: 'New Route', onPress: () => this._openSearchModal()},
      {text: 'Continue Searching', onPress: () => this._saveRoute(0.01)},
    ]
  );
}

_followerCancelledCallback(data) {
  this._turnOffListeners();
  // reset pretty much everything except own route data
  this.setState({
    nearbyRoutes: {} ,
    selectRouteMarkers: [],
    selectRoutePolylineCoords: [],
    routeSelectedKey: '',
    matchedRouteKey: '',
    completedMatchKey: '',
    matchedRoute: false,
    completedMatch: false,
    spinner: false,
    matchRequest: false,
    routeSelected: false,
  });

  const followerName = data.val().follower.username;
  const alertText = `${followerName} cancelled the match`;
  Alert.alert(
     alertText,
    'Would you like to make a new route or continue searching?',
    [
      {text: 'New Route', onPress: () => this._openSearchModal()},
      {text: 'Continue Searching', onPress: () => this._saveRoute(0.01)},
    ]
  );
}

_showPotentialMatch(data){
  //get the route out of the db that matches the author's routeKey
  //can't automatically rely on it being in this.state.nearbyRoutes
  //but should look there first to optimize things
  //come back and do that later
  firebase.database().ref('routes/' + data.val().author.routeKey)
    .once("value").then( (route) => {
      const tempRoutes = merge({}, this.state.nearbyRoutes);
      const matchedHaversine = this.haversine(
        this.state.startPosition,
        route.val().startPosition
      );
      // add the found route so later in _approveMatch don't
      // have to hit db again
      tempRoutes[matchedHaversine] = route.val();
      this.setState({
        matchedRoute: true,
        nearbyRoutes: tempRoutes,
        selectRouteMarkers: [route.val().startPosition, route.val().endPosition],
        selectRoutePolylineCoords: route.val().routePoly,
        matchedRouteKey: data.key
      });
    });
}

_turnOffListeners() {
  this.routesRef.off();
  this.matchedRoutesRef.off();
  this.completedMatchesRef.off();
}

_showSelectedRoute(haversineKey) {
  if( !(haversineKey === 0 || this.state.nearbyRoutes[haversineKey] === 'undefined')) {
    const route = this.state.nearbyRoutes[haversineKey];

    this.setState({
      routeSelectedKey: haversineKey,
      routeSelected: true,
      selectRouteMarkers: [route.startPosition, route.endPosition],
      selectRoutePolylineCoords: route.routePoly
    });
  }
}

_fitScreen() {
  let markers = [this.state.startPosition, this.state.endPosition];
  if (this.state.selectRouteMarkers.length > 0) {
    markers = markers.concat(this.state.selectRouteMarkers);
  }
  this.map.fitToCoordinates( markers,
    { edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
    animated: true,
    }
  );
}

_sendMatchRequest() {

  const route = this.getRouteByStartAndHaversine();
  let matchedRouteKey = this.matchedRoutesRef.push();
  matchedRouteKey.set({
    author: {
      userID: this.props.user.userID,
      routeKey: this.state.routeKey,
      username: this.props.user.name
    },
    follower: {
      userID: route.userID,
      routeKey: route.routeKey,
      username: route.name
    },
    key: matchedRouteKey.key
  });
  this.setState({
    matchedRouteKey: matchedRouteKey.key,
    matchRequest: true
  });
  this._setListenersOnNewMatchRequest();
}

_cancelRequest() {
  // remove the completed/matchedRoute, trigger alert, and then turn of the listner
  this._turnOffListeners();

  if(this.state.completedMatch) {
    firebase.database()
    .ref('completedMatches/' + this.state.completedMatchKey).remove();
  } else {
    firebase.database()
    .ref('matchedRoutes/' + this.state.matchedRouteKey).remove();
  }

  this.setState({
    nearbyRoutes: {} ,
    selectRouteMarkers: [],
    selectRoutePolylineCoords: [],
    routeSelectedKey: '',
    matchedRouteKey: '',
    completedMatchKey: '',
    matchedRoute: false,
    completedMatch: false,
    spinner: false,
    matchRequest: false,
    routeSelected: false
  });

  Alert.alert(
     'You cancelled the match',
    'Would you like to make a new route or continue searching?',
    [
      {text: 'New Route', onPress: () => this._openSearchModal()},
      {text: 'Continue Searching', onPress: () => this._saveRoute(0.01)},
    ]
  );
}

_setListenersOnNewMatchRequest() {
  // this.routesRef.off("child_added", this._nearbyRoutesCallback);
  // this.routesRef.off("child_removed", this._nearbyRoutesCallback);
  // this.matchedRoutesRef.off("child_added", this._matchedRoutesCallback);
  this._turnOffListeners();
  this.completedMatchesRef.orderByChild("author/userID")
    .equalTo(this.props.user.userID)
    .on("child_added", this._completedMatchCallback);
  this.matchedRoutesRef.orderByChild("author/userID")
    .equalTo(this.props.user.userID)
    .on("child_removed", this._followerCancelledCallback);
}

_completedMatchCallback(data){
  this._turnOffListeners();
  this.completedMatchesRef.orderByChild("author/userID")
    .equalTo(this.props.user.userID)
    .on("child_removed", this._followerCancelledCallback);
  const route = this.getRouteByChildValue('name', data.val().follower.username);
  const opts = {
    fromCoords: this.state.startPosition,
    toCoords: route.startPosition
  };

  const dist = this.haversine(
    this.state.startPosition,
    this.state.selectRouteMarkers[0]
  );

  // need to find the route by a different means - if the follower
  // views a different route before hitting approve then this breaks
  // find route by hitting the db with matchedRouteKey in the state
  // and then pull that out of nearbyRoutes with getRouteByChildValue
  // with the matched route author.routeKey, or name, or userID
  const routeStore = this.state.nearbyRoutes[dist];
  let tempNearby = {};
  tempNearby[dist] = routeStore;

  getDirections(opts)
  .then(directionsData => this._createRouteCoordinates(directionsData))
  .then(polylineCoords => {
    this.setState({
      completedMatchKey: data.key,
      completedMatch: true,
      nearbyRoutes: tempNearby,
      selectRouteMarkers: [this.state.startPosition, route.startPosition],
      selectRoutePolylineCoords: polylineCoords
    });
  });

  Alert.alert(
    'Match Successful!',

    `Follow the blue line to meet ${data.val().follower.username}`,
    [
      {text: 'Great!', onPress: () => {
        firebase.database().ref('matchedRoutes/' + data.val().matchedRouteKey).remove();
        firebase.database().ref('routes/' + data.val().author.routeKey).remove();
        firebase.database().ref('routes/' + data.val().follower.routeKey).remove();
      }}
    ]
  );

  this.tracker = navigator.geolocation.watchPosition(
    (position) => {
      this.setState({startPosition: position.coords });
      // not entirely sure the if statement will work
      if(position.coords === this.state.selectRouteMarkers[1]) {
        navigator.geolocation.clearWatch(this.tracker);
        Alert.alert(
          'You have reached your match!',
          'Safe travels!'
        );
      }
    },
    (error) => {
      Alert.alert(
        'There was an error getting your location',
        'Please wait for geolocation'
      );
    },
    {enableHighAccuracy: true, timeout: 20000, maximumAge: 3000}
  );
}

_approveMatch(){
  this._turnOffListeners();
  this.matchedRoutesRef.orderByChild("follower/userID")
    .equalTo(this.props.user.userID)
    .on("child_removed", this._alertAuthorIncoming);
  this.completedMatchesRef.orderByChild("follower/userID")
    .equalTo(this.props.user.userID)
    .on("child_removed", this._authorCancelledCallback);

  const dist = this.haversine(
    this.state.startPosition,
    this.state.selectRouteMarkers[0]
  );

  // need to find the route by a different means - if the follower
  // views a different route before hitting approve then this breaks
  // find route by hitting the db with matchedRouteKey in the state
  // and then pull that out of nearbyRoutes with getRouteByChildValue
  // with the matched route author.routeKey, or name, or userID
  const routeStore = this.state.nearbyRoutes[dist];
  let tempNearby = {};
  tempNearby[dist] = routeStore;


  const route = this.getRouteByStartAndHaversine();
  let completedMatchKey = this.completedMatchesRef.push();
  // remember that the current user is the follower here!
  completedMatchKey.set({
    author: {
      userID: route.userID,
      routeKey: route.routeKey,
      username: route.name
    },
    follower: {
      userID: this.props.user.userID,
      routeKey: this.state.routeKey,
      username: this.props.user.name
    },
    // for deleteing on author side of things
    matchedRouteKey: this.state.matchedRouteKey
  });

  this.setState({
    completedMatch: true,
    nearbyRoutes: tempNearby,
    completedMatchKey: completedMatchKey.key
  });

}

_alertAuthorIncoming(data){
  // get route by the data and getRouteByChildValue instead of
  // getRouteByStartAndHaversine (selected Route can change?)
  const route = this.getRouteByStartAndHaversine();
  Alert.alert(`Success!`, `${route.name} is on her way!`);
}

_denyMatch(){
  firebase.database().ref('matchedRoutes/' + this.state.matchedRouteKey).remove();
  this.matchedRoutesRef.off("child_removed", this._authorCancelledCallback);
  this.setState({
    matchedRoute: false,
    selectRouteMarkers: [],
    selectRoutePolylineCoords: []
  });
}


haversine(startLocation, testLocation) {
  function toRad(x) {
    return x * Math.PI / 180;
  }

  const lon1 = startLocation.longitude;
  const lat1 = startLocation.latitude;

  const lon2 = testLocation.longitude;
  const lat2 = testLocation.latitude;

  const R = 6371; // km

  const x1 = lat2 - lat1;
  const dLat = toRad(x1);
  const x2 = lon2 - lon1;
  const dLon = toRad(x2);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  let d = R * c;

  d /= 1.60934;
  return d;
}

getRouteByStartAndHaversine(){
  const selectRouteStart = this.state.selectRouteMarkers[0];
  const selectHaversine = this.haversine(
                            this.state.startPosition,
                            selectRouteStart
                          );
  const route = this.state.nearbyRoutes[selectHaversine];
  return route;
}

getRouteByChildValue(child, value){
  const keys = Object.keys(this.state.nearbyRoutes);
  let route;
  keys.forEach( key => {
    if (this.state.nearbyRoutes[key][child] === value) {
      route = this.state.nearbyRoutes[key];
    }
  });
  return route;
}

updateFromChild(property, value) {
  this.setState({[property]: value});
}

renderCircle(){
  if(this.state.renderCircle) {
    return (
      <MapView.Circle
        center={this.state.startPosition}
        radius={this.state.radius}
        strokeWidth={2}
        strokeColor='#ba0be0'
        fillColor={'rgba(0, 0, 0, 0.1)'}
        />
    );
  }
}

makeMarker(location, pos, title) {
  const selfMarker = {
    latlng: location,
    title: title
  };
  const markers = Object.assign([], this.state.markers);
  if(markers.length > 1) {
    markers.pop();
  }
  markers.push(selfMarker);
  this.setState({[pos]: location, markers: markers});
}

destinationButton(text) {
  return(
    <TouchableOpacity
      style={basicStyles.button, basicStyles.bubble}
      onPress={() => this._openSearchModal()}
      >
      <Text>{`${text}`}</Text>
    </TouchableOpacity>
  );
}


searchButtons(){
  if (Object.keys(this.state.endPosition).length !== 0) {
    if (this.state.selectRouteMarkers.length > 0 ) {
      return(
        <View style={basicStyles.buttonContainer}>
          {this.destinationButton("Pick a destination")}

          <TouchableOpacity
            style={basicStyles.button, basicStyles.bubble}
            onPress={() => this._sendMatchRequest()}
            >
            <Text>Match Route</Text>
          </TouchableOpacity>
        </View>
      );
    } else {
      if( this.state.routeKey === '') {
        return(
          <View style={basicStyles.buttonContainer}>
            {this.destinationButton("Pick a destination")}

            <TouchableOpacity
              style={basicStyles.button, basicStyles.bubble}
              onPress={() => this._saveRoute(0.01)}
              >
              <Text>Set Route</Text>
            </TouchableOpacity>
          </View>
        );
      } else {
        // put some kinda of alert here for if there are no nearby routes?
        // or button to expand the latitude
        return (
          <View style={basicStyles.buttonContainer}>
            { this.destinationButton("Pick a new destination") }

            <TouchableOpacity
              style={basicStyles.button, basicStyles.bubble}
              onPress={() => {
                this.setState({renderCircle: true});
                this._saveRoute(0.02);
              }
            }
              >
              <Text>Expand Search </Text>
            </TouchableOpacity>
          </View>
        );
      }
    }
  } else {
    return (
      <View style={basicStyles.buttonContainer}>
        { this.destinationButton("Pick a destination") }
      </View>
    );
  }
}

matchButtons(){
  return(
    <View style={basicStyles.buttonContainer}>
      <TouchableOpacity
        style={basicStyles.button, basicStyles.bubble}
        onPress={() => this._approveMatch()}
        >
        <Text>Approve Match</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={basicStyles.button, basicStyles.bubble}
        onPress={() => this._denyMatch()}
        >
        <Text>Deny Match</Text>
      </TouchableOpacity>
  </View>
);
}

cancelMatchButtons() {
  return(
    <View style={basicStyles.buttonContainer}>

      <ActivityIndicator
        animating={true}
        size='large'
        color='#ba0be0'
        />

      <TouchableOpacity
        style={basicStyles.button, basicStyles.bubble}
        onPress={() => this._cancelRequest()}
        >
        <Text> Cancel Match</Text>
      </TouchableOpacity>

      <ActivityIndicator
        animating={true}
        size='large'
        color='#ba0be0'
        />
    </View>
  );
}

renderButtons() {
  if (this.state.matchedRoute) {
    return (
      this.matchButtons()
    );
  } else if(this.state.matchRequest || this.state.completedMatch) {
    return (
      this.cancelMatchButtons()
    );
  } else {
    return (
      this.searchButtons()
    );
  }
}

selectedDetail() {
  const route = this.state.nearbyRoutes[this.state.routeSelectedKey];
  if (this.state.routeSelected) {
    return(
      <View style={basicStyles.selectedDetail}>
        <Image
          style={basicStyles.selectedIcon}
          source={{uri: route.imgUrl}}
          />
        <Text style={basicStyles.selectedFont}> {route.name} </Text>
        <Text style={basicStyles.selectedFont}> Message </Text>
      </View>
    );
  } else {
    return (
      <View></View>
    );
  }
}

insertModal() {
  return (
    <Modal
      animationType={"slide"}
      transparent={true}
      visible={this.state.spinner}
    >
      <View style={basicStyles.buttonContainer}>
        <ActivityIndicator
          animating={true}
          size='large'
          color='#ba0be0'
        />

        <TouchableOpacity
          style={basicStyles.button, basicStyles.bubble}
          onPress={() => this.setState({spinner: false})}
          >
          <Text> Cancel Match Request</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}


render() {
  if (Object.keys(this.state.startPosition).length === 0) {
    return (
      <View style={basicStyles.container}></View>
    );
  } else {
    return (
        <View style={basicStyles.container}>

          <MapView
            ref={ref => { this.map = ref; }}
            provider={PROVIDER_GOOGLE}
            style={basicStyles.map}
            customMapStyle={mapStyle}
            showsBuildings={true}
            onPress={(e) => {
              if(typeof e.nativeEvent.action === 'undefined') {
                this.setState({routeSelected: false});
              }
            }}
            initialRegion={{
              latitude: this.state.startPosition.latitude,
              longitude: this.state.startPosition.longitude,
              latitudeDelta: LATITUDE_DELTA,
              longitudeDelta: LONGITUDE_DELTA,
            }}
            >

            {this.state.markers.map( (marker, idx) => (
              <Marker
                coordinate={marker.latlng}
                title={marker.title}
                key={idx}
                />
            ))}

            {
              Object.keys(this.state.nearbyRoutes).map( (key, idx) => (
                <Marker
                  coordinate={this.state.nearbyRoutes[key].startPosition}
                  key={key}

                  pinColor="#39FF14"
                  onPress={() => {
                    const markerKey = key;
                    this._showSelectedRoute(markerKey);
                  }}>
                  <View>
                    <Image
                      style={basicStyles.userIcon}
                      source={{uri: this.state.nearbyRoutes[key].imgUrl}}
                      />
                  </View>
                  </Marker>

              ))
            }

            {this.state.selectRouteMarkers[1] &&
              <Marker
                coordinate={this.state.selectRouteMarkers[1]}
                pinColor={this.state.matchedRoute ? "#dd0048" : "#37fdfc"}
                />
            }

            <MapView.Polyline
              coordinates={this.state.polylineCoords}
              strokeWidth={3}
              strokeColor="#ba0be0"
              />

            <MapView.Polyline
              coordinates={this.state.selectRoutePolylineCoords}
              strokeWidth={3}
              strokeColor={this.state.matchedRoute ? "#dd0048" : "#37fdfc"}
              />

          </MapView>
          {this.selectedDetail()}
        {this.renderButtons()}

      </View>
    );
  }
}
}



export default BasicMap;
